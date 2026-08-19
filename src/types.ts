export type Mentor = {
  id: string
  name: string
  generation: string
  iconUrl: string
  imageUrl: string
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
