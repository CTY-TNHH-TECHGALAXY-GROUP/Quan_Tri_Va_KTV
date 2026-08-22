import { useMemo } from 'react';
import { Room, Bed, RoomOccupancy, ProcessedRoom, ProcessedBed } from './RoomBoard.types';

export const useRoomBoard = (rooms: Room[], beds: Bed[], occupancies: RoomOccupancy[]) => {
  const processedRooms = useMemo(() => {
    return rooms.map(room => {
      // Find beds for this room
      const roomBeds = beds.filter(b => b.roomId === room.id);
      
      const processedBeds: ProcessedBed[] = roomBeds.map(bed => {
        // Find occupancy for this bed
        // Sort by IN_PROGRESS/CLEANING first, then by others
        const bedOccs = occupancies.filter(o => o.bedId === bed.id);
        const activeOcc = bedOccs.find(o => o.status === 'IN_PROGRESS' || o.status === 'PREPARING') ||
                          bedOccs.find(o => o.status === 'CLEANING') ||
                          bedOccs[0];

        return {
          ...bed,
          occupancy: activeOcc
        };
      });

      // Calculate room status
      const totalBeds = processedBeds.length;
      const occupiedBeds = processedBeds.filter(b => b.occupancy && b.occupancy.status !== 'COMPLETED').length;

      let status: 'EMPTY' | 'PARTIAL' | 'FULL' = 'EMPTY';
      if (totalBeds > 0) {
        if (occupiedBeds === 0) status = 'EMPTY';
        else if (occupiedBeds >= totalBeds) status = 'FULL';
        else status = 'PARTIAL';
      }

      const pRoom: ProcessedRoom = {
        ...room,
        beds: processedBeds,
        status,
        occupiedBeds,
        totalBeds
      };

      return pRoom;
    });
  }, [rooms, beds, occupancies]);

  return {
    processedRooms
  };
};
