import ical from 'node-ical';
import fs from 'fs';

export interface TimeSlot {
  start: Date;
  end: Date;
  durationHours: number;
}

interface Booking {
  start: Date;
  end: Date;
  summary: string;
}

export class CalendarAgent {
  private calendarUrl: string;

  constructor(calendarUrl: string) {
    this.calendarUrl = calendarUrl;
  }

  async fetchBookings(): Promise<Booking[]> {
    let events;
    try {
      if (this.calendarUrl.startsWith('http')) {
        events = await ical.async.fromURL(this.calendarUrl);
      } else {
        // Assume local file path
        events = await ical.async.parseFile(this.calendarUrl);
      }
    } catch (error) {
      console.error("Error fetching calendar:", error);
      return [];
    }

    const bookings: Booking[] = [];
    for (const k in events) {
      if (!Object.prototype.hasOwnProperty.call(events, k)) continue;
      const event: any = events[k];
      
      if (event.type === 'VEVENT' && event.start && event.end) {
        bookings.push({
          start: new Date(event.start),
          end: new Date(event.end),
          summary: event.summary || 'Reserved',
        });
      }
    }

    // Sort by start date
    return bookings.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async findAvailableSlots(daysAhead: number = 30): Promise<TimeSlot[]> {
    const bookings = await this.fetchBookings();
    const slots: TimeSlot[] = [];
    
    // Start looking from "now"
    const now = new Date();
    const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000); // daysAhead from now

    let currentPointer = now;

    for (const booking of bookings) {
      // If booking ends before our pointer (past event relative to pointer), skip
      if (booking.end <= currentPointer) continue;

      // If booking starts after our pointer, we have a gap
      if (booking.start > currentPointer) {
        // Gap is from currentPointer to booking.start (or horizon if earlier)
        const gapEnd = booking.start > horizon ? horizon : booking.start;
        
        const duration = (gapEnd.getTime() - currentPointer.getTime()) / (1000 * 60 * 60); // hours
        
        if (duration > 0.5) { // Minimum 30 mins
          slots.push({
            start: new Date(currentPointer),
            end: new Date(gapEnd),
            durationHours: Number(duration.toFixed(2))
          });
        }
        
        // Move pointer to end of this booking
        currentPointer = booking.end;
      } else {
        // Booking overlaps current pointer (e.g. starts before now but ends in future)
        // Move pointer to end of this booking
        if (booking.end > currentPointer) {
            currentPointer = booking.end;
        }
      }
      
      // If pointer exceeds horizon, stop
      if (currentPointer >= horizon) break;
    }

    // Check final gap after last booking
    if (currentPointer < horizon) {
      const duration = (horizon.getTime() - currentPointer.getTime()) / (1000 * 60 * 60);
      if (duration > 0.5) {
        slots.push({
          start: new Date(currentPointer),
          end: new Date(horizon),
          durationHours: Number(duration.toFixed(2))
        });
      }
    }

    return slots;
  }
}
