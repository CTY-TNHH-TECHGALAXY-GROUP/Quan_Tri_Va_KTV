export interface Room {
  id: string;
  name: string;
  capacity: number;
  type: string;
}

export interface Bed {
  id: string;
  name: string;
  roomId: string;
}

export interface RoomOccupancy {
  bedId: string;
  roomId: string;
  ktvName?: string;
  endTime?: string;
  status: string; // NEW, PREPARING, IN_PROGRESS, CLEANING, COMPLETED
  serviceName: string;
}

export interface ProcessedBed extends Bed {
  occupancy?: RoomOccupancy;
}

export interface ProcessedRoom extends Room {
  beds: ProcessedBed[];
  status: 'EMPTY' | 'PARTIAL' | 'FULL';
  occupiedBeds: number;
  totalBeds: number;
}
