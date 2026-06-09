import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, UseGuards, Request, Query } from '@nestjs/common';
import { KanbanService } from './kanban.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('kanban')
@UseGuards(JwtAuthGuard, AdminGuard)
export class KanbanController {
    constructor(private readonly kanbanService: KanbanService) { }

    // Columns
    @Get('columns')
    getColumns(@Request() req) {
        return this.kanbanService.getColumns(req.user.userId);
    }

    @Post('columns')
    createColumn(@Request() req, @Body() body: { name: string; description?: string }) {
        return this.kanbanService.createColumn(req.user.userId, body);
    }

    @Patch('columns/:columnId')
    updateColumn(
        @Request() req,
        @Param('columnId', ParseIntPipe) columnId: number,
        @Body() body: { name?: string; description?: string; order?: number; active?: boolean },
    ) {
        return this.kanbanService.updateColumn(req.user.userId, columnId, body);
    }

    @Delete('columns/:columnId')
    deleteColumn(@Request() req, @Param('columnId', ParseIntPipe) columnId: number) {
        return this.kanbanService.deleteColumn(req.user.userId, columnId);
    }

    // Cards
    @Get('cards')
    getCards(@Request() req, @Query('columnId') columnId?: string) {
        return this.kanbanService.getCards(req.user.userId, columnId ? parseInt(columnId) : undefined);
    }

    @Post('cards')
    createCard(@Request() req, @Body() body: { columnId: number; title: string; description?: string; metadata?: Record<string, any> }) {
        return this.kanbanService.createCard(req.user.userId, body);
    }

    @Patch('cards/:cardId')
    updateCard(
        @Request() req,
        @Param('cardId', ParseIntPipe) cardId: number,
        @Body() body: { title?: string; description?: string; columnId?: number; order?: number; active?: boolean; metadata?: Record<string, any> },
    ) {
        return this.kanbanService.updateCard(req.user.userId, cardId, body);
    }

    @Delete('cards/:cardId')
    deleteCard(@Request() req, @Param('cardId', ParseIntPipe) cardId: number) {
        return this.kanbanService.deleteCard(req.user.userId, cardId);
    }

    @Patch('cards/:cardId/move')
    moveCard(
        @Request() req,
        @Param('cardId', ParseIntPipe) cardId: number,
        @Body() body: { toColumnId: number; order?: number },
    ) {
        return this.kanbanService.moveCard(req.user.userId, cardId, body.toColumnId, body.order);
    }

    @Patch('columns/reorder')
    reorderColumns(@Request() req, @Body() body: { updates: { columnId: number; order: number }[] }) {
        return this.kanbanService.reorderColumn(req.user.userId, body.updates);
    }

    @Patch('cards/reorder')
    reorderCards(@Request() req, @Body() body: { updates: { cardId: number; columnId: number; order: number }[] }) {
        return this.kanbanService.reorderCard(req.user.userId, body.updates);
    }
}
