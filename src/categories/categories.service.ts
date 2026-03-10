import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../entities/category.entity';

@Injectable()
export class CategoriesService {
    constructor(
        @InjectRepository(Category)
        private categoriesRepository: Repository<Category>,
    ) { }

    async findAll(): Promise<Category[]> {
        return this.categoriesRepository.find({ order: { name: 'ASC' } });
    }

    async findOne(id: number): Promise<Category> {
        const category = await this.categoriesRepository.findOne({ where: { id } });
        if (!category) {
            throw new NotFoundException('Category not found');
        }
        return category;
    }

    async create(data: Partial<Category>): Promise<Category> {
        const newCategory = this.categoriesRepository.create(data);
        return this.categoriesRepository.save(newCategory);
    }

    async update(id: number, data: Partial<Category>): Promise<Category> {
        await this.findOne(id);
        await this.categoriesRepository.update(id, data);
        return this.findOne(id);
    }

    async remove(id: number): Promise<void> {
        const category = await this.findOne(id);
        await this.categoriesRepository.remove(category);
    }
}
