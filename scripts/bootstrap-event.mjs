import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import 'dotenv/config'
import { v2 as cloudinary } from 'cloudinary'
import ExcelJS from 'exceljs'
import XLSX from 'xlsx'
import QRCode from 'qrcode'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const QR_PREFIX = 'TOKAI2026:1:'
const EVENT_ACCESS_PARAMETER = 'eventAccess'
const EVENT_ACCESS_CODE_BYTES = 32
const REQUIRED_COLUMNS = ['mentorId', 'name', 'generation']
const RESET_CONFIRMATION = 'RESET_EVENT'
const DEFAULT_IMAGES_DIRECTORY = 'data/Images'
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])

function usage() {
  return [
    '使い方:',
    '  pnpm admin:bootstrap -- --generate-mentors --input ./data/mentors.xlsx --dry-run',
    '  pnpm admin:bootstrap -- --generate-mentors --input ./data/mentors.xlsx --apply',
    '  pnpm admin:bootstrap -- --input ./data/mentors.xlsx --dry-run --images-dir ./data/Images',
    '  pnpm admin:bootstrap -- --input ./data/mentors.xlsx --apply --images-dir ./data/Images',
    '  pnpm admin:bootstrap -- --unassign syokora --apply',
    `  pnpm admin:bootstrap -- --reset-event --apply --confirm ${RESET_CONFIRMATION}`,
    '  pnpm admin:bootstrap -- --issue-entry-qr --event-url https://example.github.io/repository/ --copies 3 --apply',
    '  pnpm admin:bootstrap -- --save-entry-url --apply  # EVENT_ACCESS_QR_URL を一時的に指定',
  ].join('\n')
}

function parseArgs(args) {
  const valueAfter = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  return {
    input: valueAfter('--input'),
    output: valueAfter('--output') ?? 'admin-output',
    imagesDirectory: valueAfter('--images-dir') ?? process.env.MENTOR_IMAGES_DIR ?? DEFAULT_IMAGES_DIRECTORY,
    dryRun: args.includes('--dry-run'),
    apply: args.includes('--apply'),
    generateMentors: args.includes('--generate-mentors'),
    masterSheet: valueAfter('--master-sheet') ?? 'Mentors_All',
    surveySheet: valueAfter('--survey-sheet') ?? '参加アンケート回答者',
    targetSheet: valueAfter('--target-sheet') ?? 'Mentors',
    unassign: valueAfter('--unassign'),
    resetEvent: args.includes('--reset-event'),
    issueEntryQr: args.includes('--issue-entry-qr'),
    saveEntryUrl: args.includes('--save-entry-url'),
    eventUrl: valueAfter('--event-url') ?? process.env.EVENT_ACCESS_URL,
    entryUrl: process.env.EVENT_ACCESS_QR_URL,
    entryQrCopies: valueAfter('--copies') ?? '1',
    confirm: valueAfter('--confirm'),
  }
}

function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim()
  return String(value).trim()
}

function normalizeHeader(value) {
  return toText(value).replace(/^\uFEFF/, '')
}

function normalizeMentorName(value) {
  return toText(value)
    .normalize('NFKC')
    .replace(/[\u3041-\u3096]/gu, (character) => String.fromCharCode(character.charCodeAt(0) + 0x60))
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s_-]/gu, '')
}

function createQrId() {
  return randomBytes(24).toString('base64url')
}

function createEventAccessCode() {
  return randomBytes(EVENT_ACCESS_CODE_BYTES).toString('base64url')
}

function hashEventAccessCode(accessCode) {
  return createHash('sha256').update(accessCode).digest('hex')
}

function createEventAccessUrl(eventUrl, accessCode) {
  let url
  try {
    url = new URL(eventUrl)
  } catch {
    throw new Error('--event-url には公開済みの https:// で始まるサイトURLを指定してください。')
  }
  if (url.protocol !== 'https:') {
    throw new Error('--event-url はHTTPSのサイトURLにしてください。')
  }
  const parameters = new URLSearchParams(url.hash.slice(1))
  parameters.set(EVENT_ACCESS_PARAMETER, accessCode)
  url.hash = parameters.toString()
  return url.toString()
}

function collectionEpochFromConfig(data) {
  const value = data?.collectionEpoch
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1
}

function parseIsOpenFromStart(value) {
  const normalized = toText(value).normalize('NFKC').toLocaleLowerCase('ja-JP')
  if (!normalized || ['false', '0', 'no', 'n', 'いいえ', '非公開'].includes(normalized)) {
    return { value: false, error: null }
  }
  if (['true', '1', 'yes', 'y', 'はい', '公開'].includes(normalized)) {
    return { value: true, error: null }
  }
  return { value: false, error: 'isOpenFromStart は true / false（または はい / いいえ）で入力してください。' }
}

function validateRows(rows) {
  const errors = []
  const ids = new Set()

  for (const row of rows) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.mentorId)) errors.push(`${row.rowNumber}行目: mentorId は半角英数字・ハイフン・アンダースコアで入力してください。`)
    if (!row.name) errors.push(`${row.rowNumber}行目: name は必須です。`)
    if (!row.generation) errors.push(`${row.rowNumber}行目: generation は必須です。`)
    if (row.isOpenFromStartError) errors.push(`${row.rowNumber}行目: ${row.isOpenFromStartError}`)
    if (ids.has(row.mentorId)) errors.push(`${row.rowNumber}行目: mentorId「${row.mentorId}」が重複しています。`)
    ids.add(row.mentorId)
  }
  return errors
}

function readHeaderTable(workbook, sheetName, requiredColumns) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Excelに「${sheetName}」タブがありません。`)
  const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true, raw: true })

  let headerRowNumber = 0
  let headers = []
  for (let rowNumber = 1; rowNumber <= Math.min(sheetRows.length, 20); rowNumber += 1) {
    const candidate = (sheetRows[rowNumber - 1] ?? []).map(normalizeHeader)
    if (requiredColumns.every((column) => candidate.includes(column))) {
      headerRowNumber = rowNumber
      headers = candidate
      break
    }
  }
  if (!headerRowNumber) {
    throw new Error(`「${sheetName}」タブに ${requiredColumns.join(', ')} を含む見出し行が見つかりません。`)
  }

  const rows = []
  let dataRowsStarted = false
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheetRows.length; rowNumber += 1) {
    const values = sheetRows[rowNumber - 1] ?? []
    const record = Object.fromEntries(headers.map((header, index) => [header, toText(values[index])]))
    if (Object.values(record).every((value) => !value)) {
      if (dataRowsStarted) break
      continue
    }
    dataRowsStarted = true
    rows.push({ rowNumber, ...record })
  }
  return rows
}

async function readMentors(inputPath) {
  // 入力テンプレートはExcel以外でも開けるよう、幅広いXLSXの読み取りに対応したSheetJSを使う。
  // ExcelJSは下部のQRコード出力に引き続き使用する。
  const workbook = XLSX.readFile(inputPath, { cellDates: false })
  const sheetName = workbook.SheetNames.includes('Mentors') ? 'Mentors' : workbook.SheetNames[0]
  if (!sheetName) throw new Error('Excelにシートがありません。')
  const sourceRows = readHeaderTable(workbook, sheetName, REQUIRED_COLUMNS)

  const rows = []
  for (const record of sourceRows) {
    const isOpenFromStart = parseIsOpenFromStart(record.isOpenFromStart)
    rows.push({
      rowNumber: record.rowNumber,
      mentorId: record.mentorId,
      name: record.name,
      generation: record.generation,
      isOpenFromStart: isOpenFromStart.value,
      isOpenFromStartError: isOpenFromStart.error,
    })
  }

  if (rows.length === 0) throw new Error('メンター行がありません。')
  return rows
}

function normalizedFileName(value) {
  return normalizeMentorName(path.basename(value, path.extname(value)))
}

function imageFileMatchesMentorName(filePath, mentorName) {
  const mentorKey = normalizeMentorName(mentorName)
  const rawFileName = path.basename(filePath, path.extname(filePath)).normalize('NFKC')
  // 例: "18_現役_むむむ - 橋本莉穂" は「むむむ」という独立した要素として照合する。
  // 「プロフィール帳_現役のコピー - ゴゴティー」に含まれる「のこ」を別名として誤認しない。
  const fileNameParts = rawFileName
    .split(/[\s_-]+/gu)
    .map(normalizeMentorName)
    .filter(Boolean)
  return fileNameParts.includes(mentorKey)
}

function isImageFile(filePath) {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase('en-US'))
}

async function collectImageFiles(directory) {
  const rootDirectory = path.resolve(directory)
  const files = []

  async function walk(currentDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) await walk(entryPath)
      else if (entry.isFile() && isImageFile(entryPath)) files.push(entryPath)
    }
  }

  try {
    await walk(rootDirectory)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { rootDirectory, files: [] }
    }
    throw error
  }

  return { rootDirectory, files: files.sort((left, right) => left.localeCompare(right, 'ja')) }
}

function canonicalGeneration(value) {
  const text = toText(value).normalize('NFKC')
  const generation = /^(\d+)(?:期)?$/u.exec(text)
  if (generation) return `${generation[1]}期`
  if (/^ob\s*[・/]?\s*og$/iu.test(text.replace(/\s/gu, ''))) return 'OB・OG'
  return text
}

function generationSortValue(generation) {
  const match = /^(\d+)期$/u.exec(generation)
  if (match) return Number(match[1])
  if (generation === 'OB・OG') return Number.MAX_SAFE_INTEGER
  return Number.MAX_SAFE_INTEGER - 1
}

function isSurveyParticipationAnswer(answer) {
  const text = toText(answer)
  // 「不参加」「参加できない」を最優先で除外し、それ以外の参加・調整・遅刻/早退予定を対象にする。
  if (/(不参加|参加(?:でき|し)ません|欠席|できません)/u.test(text)) return false
  return /(参加|調整|遅刻|早退)/u.test(text)
}

function sourceMentorFromRecord(record) {
  const mentorId = toText(record.mentorId)
  const name = toText(record.name)
  const generation = canonicalGeneration(record.generation)
  if (!mentorId || !name || !generation) return null
  return { mentorId, name, generation, rowNumber: record.rowNumber }
}

function indexSourceMentors(masterRows, existingRows) {
  const mentorsByName = new Map()
  const errors = []

  const add = (record, source) => {
    const mentor = sourceMentorFromRecord(record)
    if (!mentor) return
    const key = normalizeMentorName(mentor.name)
    const previous = mentorsByName.get(key)
    if (previous && previous.mentorId !== mentor.mentorId && source === 'master') {
      errors.push(`「${mentor.name}」が${previous.mentorId}と${mentor.mentorId}の2つのmentorIdに対応しています。Mentors_Allを確認してください。`)
      return
    }
    // Mentors_All を正とし、現行 Mentors タブはそこにいない旧メンターのID補完にだけ使う。
    if (!previous || source === 'master') mentorsByName.set(key, mentor)
  }

  for (const record of existingRows) add(record, 'existing')
  for (const record of masterRows) add(record, 'master')
  return { mentorsByName, errors }
}

function surveyAnswersByMentor(workbook, sheetName, mentorsByName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Excelに「${sheetName}」タブがありません。`)
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false, raw: true })
  const answersByMentor = new Map()
  const unmatchedNames = new Set()

  for (const values of rows) {
    const name = toText(values[0])
    const answer = toText(values[2])
    if (!name || !isSurveyParticipationAnswer(answer)) continue
    const mentor = mentorsByName.get(normalizeMentorName(name))
    if (!mentor) {
      unmatchedNames.add(name)
      continue
    }
    const answers = answersByMentor.get(mentor.mentorId) ?? []
    if (!answers.includes(answer)) answers.push(answer)
    answersByMentor.set(mentor.mentorId, answers)
  }
  return { answersByMentor, unmatchedNames: [...unmatchedNames].sort((left, right) => left.localeCompare(right, 'ja')) }
}

async function generateMentorSelection(inputPath, imagesDirectory, options) {
  const workbook = XLSX.readFile(inputPath, { cellDates: false })
  const masterRows = readHeaderTable(workbook, options.masterSheet, REQUIRED_COLUMNS)
  const existingRows = workbook.Sheets[options.targetSheet]
    ? readHeaderTable(workbook, options.targetSheet, REQUIRED_COLUMNS)
    : []
  const { mentorsByName, errors } = indexSourceMentors(masterRows, existingRows)
  if (errors.length) throw new Error(`メンター一覧の入力エラー:\n- ${errors.join('\n- ')}`)

  const mentors = [...mentorsByName.values()]
  const imageInventory = await collectImageFiles(imagesDirectory)
  const { assignments, errors: imageErrors, warnings: imageWarnings } = createImageAssignments(mentors, imageInventory.files)
  if (imageErrors.length) throw new Error(`画像ファイル名エラー:\n- ${imageErrors.join('\n- ')}`)

  const { answersByMentor, unmatchedNames } = surveyAnswersByMentor(workbook, options.surveySheet, mentorsByName)
  const rows = mentors
    .map((mentor) => {
      const surveyAnswers = answersByMentor.get(mentor.mentorId) ?? []
      const assignment = assignments.get(mentor.mentorId)
      const imageFiles = [...new Set([assignment?.iconFile, assignment?.profileFile].filter(Boolean))]
      const hasImage = imageFiles.length > 0
      const participates = surveyAnswers.length > 0
      if (!participates && !hasImage) return null

      return {
        ...mentor,
        isOpenFromStart: !participates,
        reason: participates && hasImage
          ? '参加アンケート: 対象 / 画像あり'
          : participates
            ? '参加アンケート: 対象'
            : '画像あり',
        surveyAnswer: surveyAnswers.join(' / '),
        imageFiles,
      }
    })
    .filter(Boolean)
    .sort((left, right) => {
      const generationDifference = generationSortValue(left.generation) - generationSortValue(right.generation)
      if (generationDifference !== 0) return generationDifference
      return left.name.localeCompare(right.name, 'ja')
    })

  if (rows.length === 0) throw new Error('参加対象のメンターを1名も選定できませんでした。アンケート回答と画像名を確認してください。')
  return {
    rows,
    imageInventory,
    warnings: [...imageWarnings, ...unmatchedNames.map((name) => `参加アンケートの「${name}」はMentors_Allに見つからないため除外しました。`)],
    unmatchedSurveyNames: unmatchedNames,
  }
}

async function writeGeneratedMentorsSheet(inputPath, targetSheetName, selection) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(inputPath)
  const existingSheet = workbook.getWorksheet(targetSheetName)
  if (existingSheet) workbook.removeWorksheet(existingSheet.id)

  const sheet = workbook.addWorksheet(targetSheetName, { views: [{ state: 'frozen', ySplit: 3 }] })
  sheet.mergeCells('A1:F1')
  sheet.getCell('A1').value = '東海の日 プロフィール帳：当日対象メンター'
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7A284F' } }
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4EE' } }
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
  sheet.getRow(1).height = 26
  sheet.mergeCells('A2:F2')
  sheet.getCell('A2').value = '対象: 参加アンケートで参加・調整中・遅刻/早退予定の人、または data/Images 内に画像がある人'
  sheet.getCell('A2').font = { italic: true, color: { argb: 'FF6B5870' } }
  sheet.getCell('A2').alignment = { vertical: 'middle' }

  const headers = ['mentorId', 'name', 'generation', 'isOpenFromStart', '選定理由', '参加アンケート回答']
  sheet.addRow(headers)
  for (const row of selection.rows) {
    sheet.addRow([row.mentorId, row.name, row.generation, row.isOpenFromStart, row.reason, row.surveyAnswer])
  }

  const headerRow = sheet.getRow(3)
  headerRow.height = 22
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBE4B7B' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  for (let rowNumber = 4; rowNumber <= selection.rows.length + 3; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    row.alignment = { vertical: 'middle' }
    row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' }
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7FA' } }
      })
    }
  }
  sheet.columns = [
    { width: 18 },
    { width: 18 },
    { width: 13 },
    { width: 20 },
    { width: 30 },
    { width: 56 },
  ]
  sheet.autoFilter = { from: 'A3', to: `F${selection.rows.length + 3}` }
  await workbook.xlsx.writeFile(inputPath)
}

async function writeMentorSelectionReport(selection, options) {
  await fs.mkdir(options.output, { recursive: true })
  const reportPath = path.join(options.output, 'mentor-selection-report.json')
  const report = {
    generatedAt: new Date().toISOString(),
    selectedCount: selection.rows.length,
    surveyAndImageCount: selection.rows.filter((row) => row.surveyAnswer && row.imageFiles.length > 0).length,
    surveyOnlyCount: selection.rows.filter((row) => row.surveyAnswer && row.imageFiles.length === 0).length,
    imageOnlyCount: selection.rows.filter((row) => !row.surveyAnswer && row.imageFiles.length > 0).length,
    unmatchedSurveyNames: selection.unmatchedSurveyNames,
    mentors: selection.rows.map(({ mentorId, name, generation, isOpenFromStart, reason, surveyAnswer, imageFiles }) => ({
      mentorId,
      name,
      generation,
      isOpenFromStart,
      reason,
      surveyAnswer,
      imageFiles,
    })),
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return reportPath
}

function classifyImageFile(filePath) {
  const directories = path.dirname(filePath).split(path.sep).map((directory) => directory.normalize('NFKC').toLocaleLowerCase('ja-JP'))
  if (directories.some((directory) => /(icon|avatar|アイコン|あいこん)/u.test(directory))) return 'icon'
  if (directories.some((directory) => /(profile|プロフィール|ぷろふぃーる)/u.test(directory))) return 'profile'

  const name = normalizedFileName(filePath)
  if (/(icon|avatar|アイコン|あいこん)/u.test(name)) return 'icon'
  if (/(profile|プロフィール|ぷろふぃーる)/u.test(name)) return 'profile'
  return 'shared'
}

function createImageAssignments(rows, imageFiles) {
  const assignments = new Map()
  const errors = []
  const warnings = []
  const ownersByFile = new Map()

  for (const row of rows) {
    const candidates = imageFiles.filter((filePath) => imageFileMatchesMentorName(filePath, row.name))
    const icons = candidates.filter((filePath) => classifyImageFile(filePath) === 'icon')
    const profiles = candidates.filter((filePath) => classifyImageFile(filePath) === 'profile')
    const shared = candidates.filter((filePath) => classifyImageFile(filePath) === 'shared')

    if (icons.length > 1) errors.push(`${row.rowNumber}行目: ${row.name} に対応する icon / avatar / アイコン を含む画像が複数あります。1枚だけにしてください。`)
    if (profiles.length > 1) errors.push(`${row.rowNumber}行目: ${row.name} に対応する profile / プロフィール を含む画像が複数あります。1枚だけにしてください。`)
    if (shared.length > 1) errors.push(`${row.rowNumber}行目: ${row.name} に対応する種別なしの画像が複数あります。ファイル名に icon または profile を付けて区別してください。`)

    const iconFile = icons[0] ?? shared[0] ?? null
    const profileFile = profiles[0] ?? shared[0] ?? null
    assignments.set(row.mentorId, { iconFile, profileFile })

    for (const filePath of new Set([iconFile, profileFile].filter(Boolean))) {
      const previousOwner = ownersByFile.get(filePath)
      if (previousOwner && previousOwner !== row.mentorId) {
        errors.push(`${path.basename(filePath)} が ${previousOwner} と ${row.mentorId} の両方に一致しています。ファイル名にメンター名を明確に含めてください。`)
      }
      ownersByFile.set(filePath, row.mentorId)
    }
  }

  for (const imageFile of imageFiles) {
    if (!ownersByFile.has(imageFile)) {
      warnings.push(`${path.basename(imageFile)} はExcelのメンター名に一致しないため、今回の反映では使いません。`)
    }
  }

  return { assignments, errors, warnings }
}

function configureCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('画像をアップロードするには CLOUDINARY_CLOUD_NAME、CLOUDINARY_API_KEY、CLOUDINARY_API_SECRET を .env に設定してください。')
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true })
  return process.env.CLOUDINARY_FOLDER?.trim() || 'tokai-profile-book'
}

async function uploadMentorImage(filePath, publicId) {
  // Windowsの日本語パスをSDKへ文字列のまま渡すと、環境によっては file が空になり
  // Cloudinaryから400が返ることがある。ストリームなら絶対パスを確実に送信できる。
  const result = await new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream({
      resource_type: 'image',
      public_id: publicId,
      overwrite: true,
      invalidate: true,
      tags: ['tokai-profile-book', 'mentor-image'],
    }, (error, uploadResult) => {
      if (error) reject(error)
      else resolve(uploadResult)
    })
    const file = createReadStream(filePath)
    file.on('error', reject)
    file.pipe(upload)
  })
  if (!result?.secure_url) throw new Error(`${path.basename(filePath)} のCloudinary URLを取得できませんでした。`)
  return result.secure_url
}

function createOpaqueImagePublicId(folder, kind) {
  return `${folder}/${kind}/${randomBytes(24).toString('base64url')}`
}

function transformedImageUrl(secureUrl, kind) {
  const transformation = kind === 'icon'
    ? 'f_auto,q_auto,c_fill,w_256,h_256'
    : 'f_auto,q_auto,c_limit,w_1200'
  return secureUrl.replace('/upload/', `/upload/${transformation}/`)
}

function savedText(value) {
  return typeof value === 'string' && value.trim() ? value : ''
}

async function resolveMentorImages(rows, assignments, database) {
  const existingSnapshots = await Promise.all(rows.map((row) => database.doc(`mentors/${row.mentorId}`).get()))
  const existingMentors = new Map(existingSnapshots.map((snapshot) => [snapshot.id, snapshot.data() ?? {}]))
  const shouldUpload = [...assignments.values()].some(({ iconFile, profileFile }) => iconFile || profileFile)
  const cloudinaryFolder = shouldUpload ? configureCloudinary() : null
  const resolvedRows = []

  for (const row of rows) {
    const assignment = assignments.get(row.mentorId)
    const existing = existingMentors.get(row.mentorId) ?? {}
    let iconUrl = savedText(existing.iconUrl)
    let imageUrl = savedText(existing.imageUrl)
    let iconPublicId = savedText(existing.iconPublicId)
    let imagePublicId = savedText(existing.imagePublicId)

    if (assignment?.iconFile && assignment.iconFile === assignment.profileFile) {
      // 画像の公開IDには氏名やmentorIdを含めない。次回以降は保存済みのランダムIDへ上書きする。
      const publicId = imagePublicId || iconPublicId || createOpaqueImagePublicId(cloudinaryFolder, 'profiles')
      const url = await uploadMentorImage(assignment.iconFile, publicId)
      iconUrl = transformedImageUrl(url, 'icon')
      imageUrl = transformedImageUrl(url, 'profile')
      iconPublicId = publicId
      imagePublicId = publicId
    } else {
      if (assignment?.iconFile) {
        const publicId = iconPublicId || createOpaqueImagePublicId(cloudinaryFolder, 'icons')
        iconUrl = transformedImageUrl(await uploadMentorImage(assignment.iconFile, publicId), 'icon')
        iconPublicId = publicId
      }
      if (assignment?.profileFile) {
        const publicId = imagePublicId || createOpaqueImagePublicId(cloudinaryFolder, 'profiles')
        imageUrl = transformedImageUrl(await uploadMentorImage(assignment.profileFile, publicId), 'profile')
        imagePublicId = publicId
      }
    }

    if (!iconUrl && imageUrl) {
      iconUrl = transformedImageUrl(imageUrl, 'icon')
      iconPublicId = imagePublicId
    }
    if (!imageUrl && iconUrl) {
      imageUrl = transformedImageUrl(iconUrl, 'profile')
      imagePublicId = iconPublicId
    }
    resolvedRows.push({
      ...row,
      iconUrl,
      imageUrl,
      iconPublicId,
      imagePublicId,
      uploadedIconFile: assignment?.iconFile ?? null,
      uploadedProfileFile: assignment?.profileFile ?? null,
    })
  }

  return { rows: resolvedRows, cloudinaryFolder }
}

async function writeImageUploadReport(rows, cloudinaryFolder, imageDirectory, outputDirectory) {
  await fs.mkdir(outputDirectory, { recursive: true })
  const outputPath = path.join(outputDirectory, 'image-upload-report.json')
  const report = {
    generatedAt: new Date().toISOString(),
    cloudinaryFolder,
    imageDirectory,
    mentors: rows.map(({ mentorId, name, isOpenFromStart, iconUrl, imageUrl, iconPublicId, imagePublicId, uploadedIconFile, uploadedProfileFile }) => ({
      mentorId,
      name,
      isOpenFromStart,
      iconUrl,
      imageUrl,
      iconPublicId,
      imagePublicId,
      uploadedIconFile,
      uploadedProfileFile,
    })),
  }
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return outputPath
}

function initializeAdmin() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('--apply には GOOGLE_APPLICATION_CREDENTIALS でサービスアカウントJSONへのパスを指定してください。')
  }
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() })
  return getFirestore(app)
}

async function resolveQrInventory(mentorCount, database) {
  const inventory = await database.collection('qrInventory').where('active', '==', true).get()
  const activeQrIds = inventory.docs.map((snapshot) => snapshot.id).sort()
  const needed = Math.max(0, mentorCount - activeQrIds.length)
  const newQrIds = Array.from({ length: needed }, createQrId)
  return [...activeQrIds, ...newQrIds]
}

async function writeQrOutput(qrIds, outputDir) {
  const qrDir = path.join(outputDir, 'qr-images')
  await fs.mkdir(qrDir, { recursive: true })

  const workbook = new ExcelJS.Workbook()
  const list = workbook.addWorksheet('QR一覧')
  list.columns = [
    { header: '配布番号', key: 'number', width: 12 },
    { header: 'qrId', key: 'qrId', width: 38 },
    { header: 'QR文字列', key: 'payload', width: 52 },
    { header: 'PNGファイル', key: 'pngPath', width: 42 },
  ]
  list.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  list.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE85B91' } }
  list.views = [{ state: 'frozen', ySplit: 1 }]

  for (const [index, qrId] of qrIds.entries()) {
    const number = String(index + 1).padStart(3, '0')
    const payload = `${QR_PREFIX}${qrId}`
    const pngPath = path.join(qrDir, `qr-${number}.png`)
    await QRCode.toFile(pngPath, payload, { width: 600, margin: 2, errorCorrectionLevel: 'M' })
    list.addRow({ number, qrId, payload, pngPath: path.relative(outputDir, pngPath) })
  }
  list.autoFilter = 'A1:D1'

  const guide = workbook.addWorksheet('使い方')
  guide.getColumn(1).width = 105
  guide.getCell('A1').value = 'イベントQRコードの使い方'
  guide.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFE85B91' } }
  guide.getCell('A3').value = 'QR一覧シートのPNGは、メンターへランダムに配布できます。メンター本人はアプリ初回起動時に自分の名前を選び、手元の任意のQRを読み取って登録します。'
  guide.getCell('A4').value = 'QRとメンターの関係は初回登録時に一度だけ作られます。配布番号・PNGファイル名は管理用の目印で、特定のメンターを意味しません。'
  guide.getCell('A3:A4').alignment = { wrapText: true, vertical: 'top' }
  guide.getRow(3).height = 48
  guide.getRow(4).height = 48

  const outputPath = path.join(outputDir, 'qr-codes.xlsx')
  await workbook.xlsx.writeFile(outputPath)
  return outputPath
}

async function applyRows(rows, qrIds, database) {
  const config = await database.doc('appConfig/settings').get()
  const operations = [
    ...(config.exists ? [] : [{
      path: 'appConfig/settings',
      data: { isAllOpen: false, collectionEpoch: 1 },
      merge: false,
    }]),
    ...rows.map((row) => (
      {
        path: `mentors/${row.mentorId}`,
        data: {
          name: row.name,
          generation: row.generation,
          iconUrl: row.iconUrl,
          imageUrl: row.imageUrl,
          iconPublicId: row.iconPublicId,
          imagePublicId: row.imagePublicId,
          isOpenFromStart: row.isOpenFromStart,
          // Mentors タブに載る人だけを現行イベントの対象として公開する。
          // 古いドキュメントを消さず、クライアントの一覧から安全に除外する。
          active: true,
        },
        merge: false,
      }
    )),
    ...qrIds.map((qrId) => (
      {
        path: `qrInventory/${qrId}`,
        data: { active: true, issuedAt: FieldValue.serverTimestamp() },
        // 旧方式の mentorId を消し、未割当の共通QRへ移行する。
        merge: false,
      }
    )),
  ]

  for (let index = 0; index < operations.length; index += 400) {
    const batch = database.batch()
    for (const operation of operations.slice(index, index + 400)) {
      batch.set(database.doc(operation.path), operation.data, { merge: operation.merge })
    }
    await batch.commit()
  }
}

async function unassignMentor(mentorId, database) {
  const binding = await database.doc(`mentorQrBindings/${mentorId}`).get()
  if (!binding.exists) throw new Error(`mentorId「${mentorId}」には登録済みQRがありません。`)
  const qrId = binding.data().qrId
  const qrCode = await database.doc(`qrCodes/${qrId}`).get()
  const ownerUid = qrCode.data()?.registeredByUid

  const batch = database.batch()
  batch.delete(binding.ref)
  batch.delete(database.doc(`qrCodes/${qrId}`))
  if (typeof ownerUid === 'string') batch.delete(database.doc(`deviceSetups/${ownerUid}`))
  await batch.commit()
  return qrId
}

async function resetEvent(database) {
  const [qrCodes, bindings, deviceSetups, eventAccessCodes, eventAccessGrants, config] = await Promise.all([
    database.collection('qrCodes').get(),
    database.collection('mentorQrBindings').get(),
    database.collection('deviceSetups').get(),
    database.collection('eventAccessCodes').get(),
    database.collection('eventAccessGrants').get(),
    database.doc('appConfig/settings').get(),
  ])
  const documents = [...qrCodes.docs, ...bindings.docs, ...deviceSetups.docs, ...eventAccessCodes.docs, ...eventAccessGrants.docs]
  const nextEpoch = collectionEpochFromConfig(config.data()) + 1
  const operations = [
    { type: 'setConfig', reference: database.doc('appConfig/settings') },
    ...documents.map((reference) => ({ type: 'delete', reference })),
  ]

  for (let index = 0; index < operations.length; index += 400) {
    const batch = database.batch()
    for (const operation of operations.slice(index, index + 400)) {
      if (operation.type === 'setConfig') {
        batch.set(operation.reference, { isAllOpen: false, collectionEpoch: nextEpoch }, { merge: true })
      } else {
        batch.delete(operation.reference)
      }
    }
    await batch.commit()
  }

  return {
    qrCodes: qrCodes.size,
    bindings: bindings.size,
    deviceSetups: deviceSetups.size,
    eventAccessCodes: eventAccessCodes.size,
    eventAccessGrants: eventAccessGrants.size,
    collectionEpoch: nextEpoch,
  }
}

async function issueEntryQr(database, eventUrl, outputDirectory, copies) {
  const accessCode = createEventAccessCode()
  const codeHash = hashEventAccessCode(accessCode)
  const payload = createEventAccessUrl(eventUrl, accessCode)
  const qrDirectory = path.join(outputDirectory, 'entry-qr')

  await database.doc(`eventAccessCodes/${codeHash}`).set({
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  })
  await fs.mkdir(qrDirectory, { recursive: true })
  const outputPaths = []
  for (let index = 1; index <= copies; index += 1) {
    const suffix = copies === 1 ? '' : `-${String(index).padStart(2, '0')}`
    const outputPath = path.join(qrDirectory, `event-entry-qr${suffix}.png`)
    await QRCode.toFile(outputPath, payload, { width: 900, margin: 2, errorCorrectionLevel: 'H' })
    outputPaths.push(outputPath)
  }
  const urlOutputPath = await writeEntryUrlText(payload, qrDirectory)
  return { outputPaths, urlOutputPath }
}

async function writeEntryUrlText(entryUrl, qrDirectory) {
  const url = new URL(entryUrl)
  if (url.protocol !== 'https:' || !url.hash.includes(`${EVENT_ACCESS_PARAMETER}=`)) {
    throw new Error('保存する入場URLは #eventAccess= を含む HTTPS URL にしてください。')
  }
  await fs.mkdir(qrDirectory, { recursive: true })
  const outputPath = path.join(qrDirectory, 'event-entry-url.txt')
  // このURLには入場コードそのものが含まれるため、Firestoreや標準出力には保存しない。
  await fs.writeFile(outputPath, `${url.toString()}\n`, 'utf8')
  return outputPath
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.apply && !options.dryRun) throw new Error(`${usage()}\n\n--dry-run または --apply のどちらかを指定してください。`)
  if (options.apply && options.dryRun) throw new Error('--dry-run と --apply は同時に指定できません。')
  const specialOperations = [options.unassign, options.resetEvent, options.issueEntryQr, options.saveEntryUrl, options.generateMentors].filter(Boolean).length
  if (specialOperations > 1) throw new Error('--unassign、--reset-event、--issue-entry-qr、--save-entry-url、--generate-mentors は同時に指定できません。')

  if (options.generateMentors) {
    if (!options.input) throw new Error(`${usage()}\n\n--generate-mentors には --input を指定してください。`)
    const selection = await generateMentorSelection(options.input, options.imagesDirectory, options)
    if (selection.warnings.length) console.warn(`メンター選定の注意:\n- ${selection.warnings.join('\n- ')}`)

    const surveyAndImageCount = selection.rows.filter((row) => row.surveyAnswer && row.imageFiles.length > 0).length
    const surveyOnlyCount = selection.rows.filter((row) => row.surveyAnswer && row.imageFiles.length === 0).length
    const imageOnlyCount = selection.rows.filter((row) => !row.surveyAnswer && row.imageFiles.length > 0).length
    if (options.dryRun) {
      console.log(`検証OK: Mentors タブへ ${selection.rows.length}人を選定します（アンケート＋画像 ${surveyAndImageCount}人、アンケートのみ ${surveyOnlyCount}人、画像のみ ${imageOnlyCount}人）。`)
      console.log('Excel・Cloudinary・Firestore・QRファイルは変更していません。')
      return
    }

    await writeGeneratedMentorsSheet(options.input, options.targetSheet, selection)
    const reportPath = await writeMentorSelectionReport(selection, options)
    console.log(`Mentors タブを更新しました: ${selection.rows.length}人（アンケート＋画像 ${surveyAndImageCount}人、アンケートのみ ${surveyOnlyCount}人、画像のみ ${imageOnlyCount}人）`)
    console.log(`選定レポート: ${reportPath}`)
    console.log('この操作はExcelの Mentors タブと管理者レポートだけを更新します。Cloudinary・Firestore・QRは変更していません。')
    return
  }

  if (options.resetEvent) {
    if (!options.apply) throw new Error('--reset-event は --apply と一緒に指定してください。')
    if (options.confirm !== RESET_CONFIRMATION) {
      throw new Error(`全リセットを実行するには --confirm ${RESET_CONFIRMATION} を指定してください。`)
    }
    const result = await resetEvent(initializeAdmin())
    console.log(`全リセット完了: qrCodes ${result.qrCodes}件、mentorQrBindings ${result.bindings}件、deviceSetups ${result.deviceSetups}件、eventAccessCodes ${result.eventAccessCodes}件、eventAccessGrants ${result.eventAccessGrants}件を削除、collectionEpoch を ${result.collectionEpoch} に更新しました。`)
    return
  }

  if (options.unassign) {
    if (!options.apply) throw new Error('--unassign は --apply と一緒に指定してください。')
    const database = initializeAdmin()
    const qrId = await unassignMentor(options.unassign, database)
    console.log(`解除しました: ${options.unassign} ← ${qrId}`)
    return
  }

  if (options.issueEntryQr) {
    if (!options.eventUrl) throw new Error('--issue-entry-qr には --event-url または EVENT_ACCESS_URL を指定してください。')
    const copies = Number(options.entryQrCopies)
    if (!Number.isSafeInteger(copies) || copies < 1 || copies > 20) {
      throw new Error('--copies には1〜20の整数を指定してください。')
    }
    // dry-runではURLの形式だけを確認し、入場コードやQR画像は作成しない。
    if (options.dryRun) {
      createEventAccessUrl(options.eventUrl, 'dry-run')
      console.log('検証OK: 入場QRに埋め込む公開URLはHTTPS形式です。Cloudinary・Firestore・QRファイルは変更していません。')
      return
    }
    const { outputPaths, urlOutputPath } = await issueEntryQr(initializeAdmin(), options.eventUrl, options.output, copies)
    console.log(`会場入場QRを${outputPaths.length}枚発行しました:`)
    for (const outputPath of outputPaths) console.log(`- ${outputPath}`)
    console.log(`入場URLテキスト: ${urlOutputPath}`)
    console.log('すべて同じ入場パスを埋め込んだ掲示用QRです。QRに含まれる入場コードは再発行まで有効です。')
    return
  }

  if (options.saveEntryUrl) {
    if (!options.apply) throw new Error('--save-entry-url は --apply と一緒に指定してください。')
    if (!options.entryUrl) throw new Error('--save-entry-url には一時環境変数 EVENT_ACCESS_QR_URL を指定してください。')
    const outputPath = await writeEntryUrlText(options.entryUrl, path.join(options.output, 'entry-qr'))
    console.log(`入場URLテキストを保存しました: ${outputPath}`)
    return
  }

  if (!options.input) throw new Error(`${usage()}\n\n--input を指定してください。`)
  const rawRows = await readMentors(options.input)
  const validationErrors = validateRows(rawRows)
  if (validationErrors.length) throw new Error(`入力エラー:\n- ${validationErrors.join('\n- ')}`)
  const imageInventory = await collectImageFiles(options.imagesDirectory)
  const { assignments, errors: imageAssignmentErrors, warnings: imageAssignmentWarnings } = createImageAssignments(rawRows, imageInventory.files)
  if (imageAssignmentErrors.length) throw new Error(`画像ファイル名エラー:\n- ${imageAssignmentErrors.join('\n- ')}`)
  if (imageAssignmentWarnings.length) console.warn(`画像ファイルの注意:\n- ${imageAssignmentWarnings.join('\n- ')}`)

  if (options.dryRun) {
    const matchedCount = [...assignments.values()].filter(({ iconFile, profileFile }) => iconFile || profileFile).length
    console.log(`検証OK: ${rawRows.length}人分。画像フォルダ ${imageInventory.rootDirectory} を確認し、${imageInventory.files.length}枚中 ${matchedCount}人分の画像を検出しました。`)
    console.log('Cloudinary・Firestore・QRファイルは変更していません。画像未配置のメンターは、--apply 時にFirestore上の既存URLを引き継ぎます。')
    return
  }

  const database = initializeAdmin()
  const resolvedImages = await resolveMentorImages(rawRows, assignments, database)
  const qrIds = await resolveQrInventory(rawRows.length, database)
  await applyRows(resolvedImages.rows, qrIds, database)
  const imageReportPath = await writeImageUploadReport(resolvedImages.rows, resolvedImages.cloudinaryFolder, imageInventory.rootDirectory, options.output)
  const outputPath = await writeQrOutput(qrIds, options.output)
  console.log(`反映完了: mentors ${rawRows.length}件、qrInventory ${qrIds.length}件、appConfig/settings`)
  console.log(`画像レポート: ${imageReportPath}`)
  console.log(`QR出力: ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
