import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Category } from '../entities/category.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
    constructor(private readonly categoriesService: CategoriesService) { }

    @Get()
    findAll(@Request() req) {
        return this.categoriesService.findAll(req.user.userId);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Request() req) {
        return this.categoriesService.findOne(+id, req.user.userId);
    }

    @Post()
    create(@Body() createCategoryDto: Partial<Category>, @Request() req) {
        return this.categoriesService.create(req.user.userId, createCategoryDto);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateCategoryDto: Partial<Category>, @Request() req) {
        return this.categoriesService.update(+id, req.user.userId, updateCategoryDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string, @Request() req) {
        return this.categoriesService.remove(+id, req.user.userId);
    }
}
