import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ExcelJS from 'exceljs'
import QRCode from 'qrcode'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const QR_PREFIX = 'TOKAI2026:1:'
const REQUIRED_COLUMNS = ['mentorId', 'name', 'generation', 'imageUrl']
const HEADER_ALIASES = {
  'qrId（空欄で自動発行）': 'qrId',
}

function usage() {
  return [
    '使い方:',
    '  pnpm admin:bootstrap -- --input ./data/mentors.xlsx --dry-run',
    '  pnpm admin:bootstrap -- --input ./data/mentors.xlsx --apply',
    '  pnpm admin:bootstrap -- --unassign syokora --apply',
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
    dryRun: args.includes('--dry-run'),
    apply: args.includes('--apply'),
    unassign: valueAfter('--unassign'),
  }
}

function toText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim()
  return String(value).trim()
}

function normalizeHeader(value) {
  const header = toText(value).replace(/^\uFEFF/, '')
  return HEADER_ALIASES[header] ?? header
}

function createQrId() {
  return randomBytes(24).toString('base64url')
}

function isValidQrId(value) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(value)
}

function validateRows(rows) {
  const errors = []
  const ids = new Set()
  const qrIds = new Set()

  for (const row of rows) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.mentorId)) errors.push(`${row.rowNumber}行目: mentorId は半角英数字・ハイフン・アンダースコアで入力してください。`)
    if (!row.name) errors.push(`${row.rowNumber}行目: name は必須です。`)
    if (!row.generation) errors.push(`${row.rowNumber}行目: generation は必須です。`)
    try {
      const url = new URL(row.imageUrl)
      if (url.protocol !== 'https:') throw new Error()
    } catch {
      errors.push(`${row.rowNumber}行目: imageUrl は https:// で始まるURLを入力してください。`)
    }
    if (ids.has(row.mentorId)) errors.push(`${row.rowNumber}行目: mentorId「${row.mentorId}」が重複しています。`)
    ids.add(row.mentorId)
    if (row.qrId && !isValidQrId(row.qrId)) errors.push(`${row.rowNumber}行目: qrId の形式が正しくありません。`)
    if (row.qrId && qrIds.has(row.qrId)) errors.push(`${row.rowNumber}行目: qrId が重複しています。`)
    if (row.qrId) qrIds.add(row.qrId)
  }
  return errors
}

async function readMentors(inputPath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(inputPath)
  const sheet = workbook.getWorksheet('Mentors') ?? workbook.worksheets[0]
  if (!sheet) throw new Error('Excelにシートがありません。')

  let headerRowNumber = 0
  let headers = []
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const candidate = sheet.getRow(rowNumber).values.slice(1).map(normalizeHeader)
    if (REQUIRED_COLUMNS.every((column) => candidate.includes(column))) {
      headerRowNumber = rowNumber
      headers = candidate
      break
    }
  }
  if (!headerRowNumber) throw new Error(`mentorId, name, generation, imageUrl を含む見出し行が見つかりません。`)

  const rows = []
  let dataRowsStarted = false
  let dataSectionEnded = false
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (dataSectionEnded) break
    const row = sheet.getRow(rowNumber)
    const values = row.values.slice(1)
    const record = Object.fromEntries(headers.map((header, index) => [header, toText(values[index])]))
    if (Object.values(record).every((value) => !value)) {
      // テンプレートでは表と入力ルールを空行で区切る。以降の説明欄は登録しない。
      if (dataRowsStarted) dataSectionEnded = true
      continue
    }
    dataRowsStarted = true
    rows.push({
      rowNumber,
      mentorId: record.mentorId,
      name: record.name,
      generation: record.generation,
      imageUrl: record.imageUrl,
      qrId: record.qrId || '',
    })
  }

  if (rows.length === 0) throw new Error('メンター行がありません。')
  return rows
}

function initializeAdmin() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('--apply には GOOGLE_APPLICATION_CREDENTIALS でサービスアカウントJSONへのパスを指定してください。')
  }
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() })
  return getFirestore(app)
}

async function enrichWithExistingBindings(rows, database) {
  return Promise.all(rows.map(async (row) => {
    const binding = await database.doc(`mentorQrBindings/${row.mentorId}`).get()
    const boundQrId = binding.data()?.qrId
    if (typeof boundQrId === 'string') {
      if (row.qrId && row.qrId !== boundQrId) {
        throw new Error(`${row.rowNumber}行目: ${row.mentorId} はすでに別のQRへ登録済みです。変更する場合は先に --unassign を実行してください。`)
      }
      return { ...row, qrId: boundQrId }
    }

    const inventory = await database.collection('qrInventory').where('mentorId', '==', row.mentorId).get()
    const activeQrIds = inventory.docs
      .filter((snapshot) => snapshot.data().active === true)
      .map((snapshot) => snapshot.id)

    if (row.qrId && activeQrIds.length > 0 && !activeQrIds.includes(row.qrId)) {
      throw new Error(`${row.rowNumber}行目: ${row.mentorId} にはすでに別の未登録QRがあります。QRを変更する場合は、管理者が既存QRを無効化してから実行してください。`)
    }
    if (!row.qrId && activeQrIds.length === 1) return { ...row, qrId: activeQrIds[0] }
    if (!row.qrId && activeQrIds.length > 1) {
      throw new Error(`${row.rowNumber}行目: ${row.mentorId} には複数の未登録QRがあります。qrId列に使うQRの値を入力してください。`)
    }

    return { ...row, qrId: row.qrId || createQrId() }
  }))
}

async function writeQrOutput(rows, outputDir) {
  const qrDir = path.join(outputDir, 'qr-images')
  await fs.mkdir(qrDir, { recursive: true })

  const workbook = new ExcelJS.Workbook()
  const list = workbook.addWorksheet('QR一覧')
  list.columns = [
    { header: 'mentorId', key: 'mentorId', width: 20 },
    { header: 'name', key: 'name', width: 18 },
    { header: 'generation', key: 'generation', width: 14 },
    { header: 'qrId', key: 'qrId', width: 38 },
    { header: 'QR文字列', key: 'payload', width: 52 },
    { header: 'PNGファイル', key: 'pngPath', width: 42 },
  ]
  list.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  list.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE85B91' } }
  list.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of rows) {
    const payload = `${QR_PREFIX}${row.qrId}`
    const pngPath = path.join(qrDir, `${row.mentorId}.png`)
    await QRCode.toFile(pngPath, payload, { width: 600, margin: 2, errorCorrectionLevel: 'M' })
    list.addRow({ ...row, payload, pngPath: path.relative(outputDir, pngPath) })
  }
  list.autoFilter = 'A1:F1'

  const guide = workbook.addWorksheet('使い方')
  guide.getColumn(1).width = 105
  guide.getCell('A1').value = 'イベントQRコードの使い方'
  guide.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFE85B91' } }
  guide.getCell('A3').value = 'QR一覧シートのPNGを、対応するメンター本人へ1枚ずつ配布してください。メンター本人はアプリ初回起動時に自分の名前を選び、自分のQRを読み取って登録します。'
  guide.getCell('A4').value = 'qrIdを変更すると、すでに登録されたQRは使えなくなります。登録済みメンターを変更する場合は、先に管理コマンドの --unassign を使ってください。'
  guide.getCell('A3:A4').alignment = { wrapText: true, vertical: 'top' }
  guide.getRow(3).height = 48
  guide.getRow(4).height = 48

  const outputPath = path.join(outputDir, 'qr-codes.xlsx')
  await workbook.xlsx.writeFile(outputPath)
  return outputPath
}

async function applyRows(rows, database) {
  const config = await database.doc('appConfig/settings').get()
  const operations = [
    ...(config.exists ? [] : [{
      path: 'appConfig/settings',
      data: { isAllOpen: false },
      merge: false,
    }]),
    ...rows.flatMap((row) => [
      {
        path: `mentors/${row.mentorId}`,
        data: { name: row.name, generation: row.generation, imageUrl: row.imageUrl },
        merge: false,
      },
      {
        path: `qrInventory/${row.qrId}`,
        data: { active: true, mentorId: row.mentorId, issuedAt: FieldValue.serverTimestamp() },
        merge: true,
      },
    ]),
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

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.apply && !options.dryRun) throw new Error(`${usage()}\n\n--dry-run または --apply のどちらかを指定してください。`)
  if (options.apply && options.dryRun) throw new Error('--dry-run と --apply は同時に指定できません。')

  if (options.unassign) {
    if (!options.apply) throw new Error('--unassign は --apply と一緒に指定してください。')
    const database = initializeAdmin()
    const qrId = await unassignMentor(options.unassign, database)
    console.log(`解除しました: ${options.unassign} ← ${qrId}`)
    return
  }

  if (!options.input) throw new Error(`${usage()}\n\n--input を指定してください。`)
  const rawRows = await readMentors(options.input)
  const validationErrors = validateRows(rawRows)
  if (validationErrors.length) throw new Error(`入力エラー:\n- ${validationErrors.join('\n- ')}`)

  if (options.dryRun) {
    console.log(`検証OK: ${rawRows.length}人分。Firestore・QRファイルは変更していません。`)
    return
  }

  const database = initializeAdmin()
  const rows = await enrichWithExistingBindings(rawRows, database)
  await applyRows(rows, database)
  const outputPath = await writeQrOutput(rows, options.output)
  console.log(`反映完了: mentors ${rows.length}件、qrInventory ${rows.length}件、appConfig/settings`)
  console.log(`QR出力: ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
