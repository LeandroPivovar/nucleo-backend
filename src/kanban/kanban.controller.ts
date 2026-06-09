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
    async getColumns(@Request() req) {
        return { columns: await this.kanbanService.getColumns(req.user.userId) };
    }

    @Post('columns')
    async createColumn(@Request() req, @Body() body: { name: string; description?: string }) {
        return { column: await this.kanbanService.createColumn(req.user.userId, body) };
    }

    @Patch('columns/:columnId')
    async updateColumn(
        @Request() req,
        @Param('columnId', ParseIntPipe) columnId: number,
        @Body() body: { name?: string; description?: string; order?: number; active?: boolean },
    ) {
        return { column: await this.kanbanService.updateColumn(req.user.userId, columnId, body) };
    }

    @Delete('columns/:columnId')
    async deleteColumn(@Request() req, @Param('columnId', ParseIntPipe) columnId: number) {
        return this.kanbanService.deleteColumn(req.user.userId, columnId);
    }

    // Cards
    @Get('cards')
    async getCards(@Request() req, @Query('columnId') columnId?: string) {
        return { cards: await this.kanbanService.getCards(req.user.userId, columnId ? parseInt(columnId) : undefined) };
    }

    @Post('cards')
    async createCard(@Request() req, @Body() body: { columnId: number; title: string; description?: string; metadata?: Record<string, any> }) {
        return { card: await this.kanbanService.createCard(req.user.userId, body) };
    }

    @Patch('cards/:cardId')
    async updateCard(
        @Request() req,
        @Param('cardId', ParseIntPipe) cardId: number,
        @Body() body: { title?: string; description?: string; columnId?: number; order?: number; active?: boolean; metadata?: Record<string, any> },
    ) {
        return { card: await this.kanbanService.updateCard(req.user.userId, cardId, body) };
    }

    @Delete('cards/:cardId')
    async deleteCard(@Request() req, @Param('cardId', ParseIntPipe) cardId: number) {
        return this.kanbanService.deleteCard(req.user.userId, cardId);
    }

    @Patch('cards/:cardId/move')
    async moveCard(
        @Request() req,
        @Param('cardId', ParseIntPipe) cardId: number,
        @Body() body: { toColumnId: number; order?: number },
    ) {
        return { card: await this.kanbanService.moveCard(req.user.userId, cardId, body.toColumnId, body.order) };
    }

    @Patch('columns/reorder')
    async reorderColumns(@Request() req, @Body() body: { updates: { columnId: number; order: number }[] }) {
        return this.kanbanService.reorderColumn(req.user.userId, body.updates);
    }

    @Patch('cards/reorder')
    async reorderCards(@Request() req, @Body() body: { updates: { cardId: number; columnId: number; order: number }[] }) {
        return this.kanbanService.reorderCard(req.user.userId, body.updates);
    }
}
