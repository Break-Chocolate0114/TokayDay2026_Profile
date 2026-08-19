export type Mentor = {
  id: string
  name: string
  generation: string
  imageUrl: string
}

export type AppConfig = {
  isAllOpen: boolean
}

export type OwnerType = 'mentor' | 'other'

export type DeviceSetup = {
  ownerType: OwnerType
  mentorId?: string
  qrId?: string
}
