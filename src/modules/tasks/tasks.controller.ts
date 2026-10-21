import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TasksService } from './tasks.service';
import {
  ApproveTaskResponseDto,
  CancelTaskResponseDto,
  CreateTaskDto,
  CreateTaskResponseDto,
  RejectTaskDto,
  RejectTaskResponseDto,
  SubmitTaskDto,
  SubmitTaskResponseDto,
  TaskResponseDto,
  UpdateTaskDto,
  RequestNewTaskDto,
  RequestNewTaskResponseDto,
} from './tasks.dto';
import { TaskStatus } from '#generated/prisma';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({
    summary: 'Создать задачу для ребенка с денежным вознаграждением (для родителя)',
    description:
      'Родитель создает задачу с вознаграждением в BYN. Деньги СРАЗУ списываются с карты родителя (эскроу). Если средств недостаточно — возвращается ошибка 400. Можно назначить конкретного ребенка или оставить задачу открытой для любого ребенка в семье.',
  })
  @ApiResponse({
    status: 201,
    description: 'Задача успешно создана, вознаграждение заблокировано',
    type: CreateTaskResponseDto,
  })
  async createTask(@Req() req: any, @Body() dto: CreateTaskDto) {
    const parentId = req.user.id || req.user.sub;
    return this.tasksService.createTask(parentId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Получить список задач (для родителя или ребенка)',
    description:
      'Если авторизован родитель — возвращает созданные им задачи. Если ребенок — возвращает задачи от его родителей, назначенные на него или открытые для всей семьи.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: TaskStatus,
    description: 'Фильтрация по статусу задачи (OPEN, IN_PROGRESS, SUBMITTED, COMPLETED, CANCELLED)',
  })
  @ApiResponse({
    status: 200,
    description: 'Список задач',
    type: [TaskResponseDto],
  })
  async getTasks(@Req() req: any, @Query('status') status?: TaskStatus) {
    const userId = req.user.id || req.user.sub;
    return this.tasksService.getTasks(userId, status);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Получить детальную информацию по конкретной задаче',
    description: 'Возвращает подробности задачи, включая исполнителя, статус, дедлайн и сумму.',
  })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({
    status: 200,
    description: 'Информация о задаче',
    type: TaskResponseDto,
  })
  async getTaskById(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id || req.user.sub;
    return this.tasksService.getTaskById(userId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Редактировать задачу (контент, сумма вознаграждения, дедлайн, исполнитель)',
    description:
      'Позволяет родителю изменить текст, дедлайн или назначение ребенка. Если меняется сумма вознаграждения: при увеличении списывается доплата с карты, при уменьшении — разница сразу возвращается на карту родителя.',
  })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({
    status: 200,
    description: 'Задача успешно обновлена',
    type: TaskResponseDto,
  })
  async updateTask(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.tasksService.updateTask(parentId, id, dto);
  }

  @Post('request-new')
  @ApiOperation({
    summary: 'Попросить новое задание у родителей (для ребенка)',
    description:
      'Ребенок отправляет родителям запрос на новое задание с опциональным комментарием (например: "Хочу накопить на ноутбук, дайте задание!"). Родители получают Push-уведомление через WebSockets.',
  })
  @ApiResponse({
    status: 200,
    description: 'Запрос на задание успешно отправлен родителям',
    type: RequestNewTaskResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Доступно только детям с привязанными родителями' })
  async requestNewTask(
    @Req() req: any,
    @Body() dto: RequestNewTaskDto,
  ) {
    const childId = req.user.id || req.user.sub;
    return this.tasksService.requestNewTask(childId, dto);
  }

  @Post(':id/submit')
  @ApiOperation({
    summary: 'Отправить отчет о выполнении задачи на проверку родителю (для ребенка)',
    description:
      'Ребенок сообщает, что выполнил задачу, прикрепляет комментарий и указывает карту для зачисления. Статус переходит в SUBMITTED.',
  })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({
    status: 200,
    description: 'Отчет о выполнении отправлен родителю',
    type: SubmitTaskResponseDto,
  })
  async submitTask(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitTaskDto,
  ) {
    const childId = req.user.id || req.user.sub;
    return this.tasksService.submitTask(childId, id, dto);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Подтвердить выполнение задачи и выплатить вознаграждение (для родителя)',
    description:
      'Родитель подтверждает качественное выполнение задачи. Деньги (вознаграждение) автоматически перечисляются на карту ребенка, статус становится COMPLETED.',
  })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({
    status: 200,
    description: 'Выполнение подтверждено, вознаграждение выплачено ребенку',
    type: ApproveTaskResponseDto,
  })
  async approveTask(@Req() req: any, @Param('id') id: string) {
    const parentId = req.user.id || req.user.sub;
    return this.tasksService.approveTask(parentId, id);
  }

  @Post(':id/reject')
  @ApiOperation({
    summary: 'Отклонить выполнение задачи / отправить на доработку (для родителя)',
    description:
      'Если ребенок не доделал задачу, родитель указывает причину. Статус задачи возвращается в работу, чтобы ребенок мог исправить замечания.',
  })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({
    status: 200,
    description: 'Задача отправлена ребенку на доработку',
    type: RejectTaskResponseDto,
  })
  async rejectTask(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RejectTaskDto,
  ) {
    const parentId = req.user.id || req.user.sub;
    return this.tasksService.rejectTask(parentId, id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Отменить задачу родителем с возвратом зарезервированных денег',
    description:
      'Родитель отменяет задачу. Зарезервированная сумма вознаграждения сразу возвращается на банковскую карту родителя, статус становится CANCELLED.',
  })
  @ApiParam({ name: 'id', description: 'ID задачи' })
  @ApiResponse({
    status: 200,
    description: 'Задача отменена, деньги возвращены родителю',
    type: CancelTaskResponseDto,
  })
  async cancelTask(@Req() req: any, @Param('id') id: string) {
    const parentId = req.user.id || req.user.sub;
    return this.tasksService.cancelTask(parentId, id);
  }
}
