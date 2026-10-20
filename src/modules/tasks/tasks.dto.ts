import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const TaskStatusEnum = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'SUBMITTED',
  'COMPLETED',
  'CANCELLED',
]);

// 1. Создание задачи
export const CreateTaskSchema = z.object({
  title: z
    .string()
    .min(1, 'Название задачи обязательно')
    .describe('Название задачи, например: "Убрать в комнате", "Получить 9 по математике"'),
  description: z
    .string()
    .optional()
    .describe('Подробные инструкции или критерии выполнения задачи'),
  rewardAmount: z
    .number()
    .gte(0.1, 'Минимальная сумма вознаграждения — 0.10 BYN')
    .describe('Сумма денежного вознаграждения в BYN, которая сразу списывается с карты родителя'),
  deadline: z
    .string()
    .optional()
    .describe('Дедлайн выполнения задачи (ISO строка, например 2026-10-25T18:00:00.000Z)'),
  assignedChildId: z
    .string()
    .uuid('Некорректный ID ребенка')
    .optional()
    .describe('ID конкретного ребенка. Если не указан — задача открыта для любого ребенка в семье'),
  creatorCardId: z
    .string()
    .uuid('Некорректный ID карты')
    .optional()
    .describe('Карта родителя, с которой списываются деньги. Если не указана — берется основная карта родителя'),
});

export class CreateTaskDto extends createZodDto(CreateTaskSchema) {}

// 2. Редактирование задачи
export const UpdateTaskSchema = z.object({
  title: z.string().min(1, 'Название задачи обязательно').optional(),
  description: z.string().optional(),
  rewardAmount: z
    .number()
    .gte(0.1, 'Минимальная сумма вознаграждения — 0.10 BYN')
    .optional()
    .describe('Новая сумма вознаграждения. Разница списывается с карты или возвращается родителю'),
  deadline: z.string().nullable().optional(),
  assignedChildId: z
    .string()
    .uuid('Некорректный ID ребенка')
    .nullable()
    .optional()
    .describe('Назначить конкретного ребенка или null (открыта для всех детей семьи)'),
  creatorCardId: z
    .string()
    .uuid('Некорректный ID карты')
    .optional()
    .describe('Карта для доплаты (если сумма вознаграждения увеличивается)'),
});

export class UpdateTaskDto extends createZodDto(UpdateTaskSchema) {}

// 3. Отправка ребенком отчета о выполнении
export const SubmitTaskSchema = z.object({
  comment: z
    .string()
    .optional()
    .describe('Комментарий ребенка о проделанной работе ("Я пропылесосил и вытер пыль")'),
  targetCardId: z
    .string()
    .uuid('Некорректный ID карты')
    .optional()
    .describe('Карта ребенка для зачисления награды. Если не указана — используется основная карта'),
});

export class SubmitTaskDto extends createZodDto(SubmitTaskSchema) {}

// 4. Отклонение родителем выполнения
export const RejectTaskSchema = z.object({
  reason: z
    .string()
    .min(1, 'Укажите причину отправки на доработку')
    .describe('Причина отклонения ("Под кроватью остался мусор, доделай")'),
});

export class RejectTaskDto extends createZodDto(RejectTaskSchema) {}

// --- Swagger Response DTOs ---

export class TaskUserShortDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Иван' })
  name: string;

  @ApiProperty({ example: '+375291234567', required: false })
  phoneNumber?: string;

  @ApiProperty({ example: 'CHILD_7_13', required: false })
  role?: string;
}

export class TaskCardShortDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: '4258 •••• •••• 1234' })
  cardNumberMask: string;

  @ApiProperty({ example: 'ИВАН ДРЁМИН', required: false })
  cardholderName?: string;
}

export class TaskResponseDto {
  @ApiProperty({ example: 'b3f5c71a-47d2-432a-bc91-382940294821' })
  id: string;

  @ApiProperty({ example: 'Убрать в комнате' })
  title: string;

  @ApiProperty({ example: 'Пропылесосить, протереть пыль и заправить постель', required: false, nullable: true })
  description?: string | null;

  @ApiProperty({ example: 15.0 })
  rewardAmount: number;

  @ApiProperty({ example: '2026-10-25T18:00:00.000Z', required: false, nullable: true })
  deadline?: Date | null;

  @ApiProperty({ example: 'OPEN', enum: ['OPEN', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED'] })
  status: string;

  @ApiProperty({ type: TaskUserShortDto })
  creator: TaskUserShortDto;

  @ApiProperty({ type: TaskCardShortDto, required: false, nullable: true })
  creatorCard?: TaskCardShortDto | null;

  @ApiProperty({ type: TaskUserShortDto, required: false, nullable: true })
  assignedChild?: TaskUserShortDto | null;

  @ApiProperty({ type: TaskUserShortDto, required: false, nullable: true })
  completedBy?: TaskUserShortDto | null;

  @ApiProperty({ type: TaskCardShortDto, required: false, nullable: true })
  targetCard?: TaskCardShortDto | null;

  @ApiProperty({ example: 'Я всё сделал!', required: false, nullable: true })
  submissionComment?: string | null;

  @ApiProperty({ example: '2026-10-21T14:30:00.000Z', required: false, nullable: true })
  submittedAt?: Date | null;

  @ApiProperty({ example: 'Нужно еще вытереть пыль с полок', required: false, nullable: true })
  rejectionReason?: string | null;

  @ApiProperty({ example: '2026-10-21T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-21T10:00:00.000Z' })
  updatedAt: Date;
}

export class CreateTaskResponseDto {
  @ApiProperty({ example: 'Задача успешно создана, вознаграждение 15 BYN списано с карты родителя' })
  message: string;

  @ApiProperty({ example: 485.0 })
  parentCardBalance: number;

  @ApiProperty({ type: TaskResponseDto })
  task: TaskResponseDto;
}

export class SubmitTaskResponseDto {
  @ApiProperty({ example: 'Отчет о выполнении задачи успешно отправлен родителям на проверку' })
  message: string;

  @ApiProperty({ type: TaskResponseDto })
  task: TaskResponseDto;
}

export class ApproveTaskResponseDto {
  @ApiProperty({ example: 'Выполнение задачи подтверждено! Вознаграждение 15 BYN зачислено ребенку Иван' })
  message: string;

  @ApiProperty({ example: 65.0 })
  childCardBalance: number;

  @ApiProperty({ type: TaskResponseDto })
  task: TaskResponseDto;
}

export class RejectTaskResponseDto {
  @ApiProperty({ example: 'Задача отправлена на доработку с указанием замечаний' })
  message: string;

  @ApiProperty({ type: TaskResponseDto })
  task: TaskResponseDto;
}

export class CancelTaskResponseDto {
  @ApiProperty({ example: 'Задача отменена, вознаграждение 15 BYN возвращено на карту родителя' })
  message: string;

  @ApiProperty({ example: 500.0 })
  parentCardBalance: number;

  @ApiProperty({ type: TaskResponseDto })
  task: TaskResponseDto;
}
