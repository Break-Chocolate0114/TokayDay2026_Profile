export type Mentor = {
  id: string
  name: string
  generation: string
  iconUrl: string
  imageUrl: string
  /** 当日不参加など、QR未獲得でもイベント開始時から閲覧を許可するメンターか。 */
  isOpenFromStart: boolean
}

export type AppConfig = {
  isAllOpen: boolean
  collectionEpoch: number
}

export type OwnerType = 'mentor' | 'other'

export type DeviceSetup = {
  ownerType: OwnerType
  mentorId?: string
  qrId?: string
}
