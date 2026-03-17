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

    async findAll(userId: number): Promise<Category[]> {
        return this.categoriesRepository.find({
            where: [
                { userId },
                { userId: 1 }
            ],
            order: { name: 'ASC' }
        });
    }

    async findOne(id: number, userId: number): Promise<Category> {
        const category = await this.categoriesRepository.findOne({ where: { id, userId } });
        if (!category) {
            throw new NotFoundException('Category not found');
        }
        return category;
    }

    async create(userId: number, data: Partial<Category>): Promise<Category> {
        const newCategory = this.categoriesRepository.create({ ...data, userId });
        return this.categoriesRepository.save(newCategory);
    }

    async update(id: number, userId: number, data: Partial<Category>): Promise<Category> {
        await this.findOne(id, userId);
        await this.categoriesRepository.update(id, data);
        return this.findOne(id, userId);
    }

    async remove(id: number, userId: number): Promise<void> {
        const category = await this.findOne(id, userId);
        await this.categoriesRepository.remove(category);
    }
}
