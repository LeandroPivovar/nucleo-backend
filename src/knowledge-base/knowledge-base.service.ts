import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tutorial } from '../entities/tutorial.entity';

@Injectable()
export class KnowledgeBaseService {
    constructor(
        @InjectRepository(Tutorial)
        private tutorialRepository: Repository<Tutorial>,
    ) { }

    async findAll() {
        return this.tutorialRepository.find({
            order: { createdAt: 'DESC' },
        });
    }

    async findOne(id: number) {
        const tutorial = await this.tutorialRepository.findOne({ where: { id } });
        if (!tutorial) throw new NotFoundException('Tutorial não encontrado');
        return tutorial;
    }

    async create(data: { title: string; pdfUrl: string }) {
        const tutorial = this.tutorialRepository.create(data);
        return this.tutorialRepository.save(tutorial);
    }

    async update(id: number, data: { title?: string; pdfUrl?: string }) {
        const tutorial = await this.findOne(id);
        Object.assign(tutorial, data);
        return this.tutorialRepository.save(tutorial);
    }

    async remove(id: number) {
        const tutorial = await this.findOne(id);
        return this.tutorialRepository.remove(tutorial);
    }
}
