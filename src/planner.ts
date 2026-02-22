import fs from 'fs';
import { TimeSlot } from './calendar';

export interface Task {
  id: string;
  title: string;
  durationHours: number;
  priority: 'high' | 'medium' | 'low';
  providerId: string;
}

export interface ScheduledTask {
  task: Task;
  start: Date;
  end: Date;
}

export class PlannerAgent {
  private tasksFile: string;

  constructor(tasksFile: string) {
    this.tasksFile = tasksFile;
  }

  loadTasks(): Task[] {
    try {
      if (!fs.existsSync(this.tasksFile)) return [];
      const data = fs.readFileSync(this.tasksFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error("Error loading tasks:", error);
      return [];
    }
  }

  schedule(slots: TimeSlot[]): ScheduledTask[] {
    const tasks = this.loadTasks();
    const scheduled: ScheduledTask[] = [];

    // Configuración de horario laboral
    const WORK_START_HOUR = 8;
    const WORK_END_HOUR = 18;

    // Ordenar tareas por prioridad
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Copia de slots para trackear tiempo usado
    let availableSlots = slots.map(s => ({ 
      ...s, 
      currentPointer: new Date(s.start.getTime()) 
    }));

    for (const task of tasks) {
      let allocated = false;
      
      for (const slot of availableSlots) {
        // Intentar encontrar el primer momento válido dentro de este slot
        let candidateStart = new Date(slot.currentPointer);

        while (candidateStart < slot.end) {
          // Ajustar al inicio de la jornada si estamos antes
          if (candidateStart.getHours() < WORK_START_HOUR) {
            candidateStart.setHours(WORK_START_HOUR, 0, 0, 0);
          }
          
          // Si nos pasamos del fin de jornada, saltar al día siguiente a las 08:00
          if (candidateStart.getHours() >= WORK_END_HOUR) {
            candidateStart.setDate(candidateStart.getDate() + 1);
            candidateStart.setHours(WORK_START_HOUR, 0, 0, 0);
            continue;
          }

          const candidateEnd = new Date(candidateStart.getTime() + task.durationHours * 60 * 60 * 1000);

          // Verificar:
          // 1. ¿Termina antes de que acabe el hueco del calendario?
          // 2. ¿Termina antes de que acabe la jornada laboral de ese mismo día?
          const endOfWorkDay = new Date(candidateStart);
          endOfWorkDay.setHours(WORK_END_HOUR, 0, 0, 0);

          if (candidateEnd <= slot.end && candidateEnd <= endOfWorkDay) {
            scheduled.push({ task, start: new Date(candidateStart), end: candidateEnd });
            slot.currentPointer = candidateEnd;
            allocated = true;
            break;
          } else {
            // Si no cabe hoy, saltar al día siguiente
            candidateStart.setDate(candidateStart.getDate() + 1);
            candidateStart.setHours(WORK_START_HOUR, 0, 0, 0);
          }
          
          // Seguridad para no entrar en bucle infinito si el slot es muy largo pero la tarea no cabe en una jornada
          if (task.durationHours > (WORK_END_HOUR - WORK_START_HOUR)) {
             console.warn(`Tarea "${task.title}" es más larga que una jornada laboral completa. Dividirla en partes.`);
             break;
          }
        }
        if (allocated) break;
      }

      if (!allocated) {
        console.warn(`[PLANNER] No se pudo agendar: "${task.title}" (${task.durationHours}h). No hay huecos laborales suficientes.`);
      }
    }
    
    return scheduled;
  }
}
