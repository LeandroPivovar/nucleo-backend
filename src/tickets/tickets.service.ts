import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../entities/ticket.entity';
import { TicketMessage } from '../entities/ticket-message.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket)
    private ticketsRepository: Repository<Ticket>,
    @InjectRepository(TicketMessage)
    private messagesRepository: Repository<TicketMessage>,
  ) {}

  async createTicket(user: any, data: { subject: string; category: string; message: string }) {
    const ticket = this.ticketsRepository.create({
      subject: data.subject,
      category: data.category,
      userId: user.userId,
    });
    const savedTicket = await this.ticketsRepository.save(ticket);

    const firstMessage = this.messagesRepository.create({
      message: data.message,
      ticket: savedTicket,
      sender: { id: user.userId } as User,
      isAdmin: false,
    });
    await this.messagesRepository.save(firstMessage);

    return savedTicket;
  }

  async getUserTickets(userId: number) {
    return this.ticketsRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }

  async getTicketById(ticketId: number, userId?: number, isAdmin: boolean = false) {
    const query = this.ticketsRepository.createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.messages', 'messages')
      .leftJoinAndSelect('messages.sender', 'sender')
      .where('ticket.id = :ticketId', { ticketId });

    if (!isAdmin && userId) {
      query.andWhere('ticket.userId = :userId', { userId });
    }

    const ticket = await query.getOne();
    if (!ticket) throw new NotFoundException('Ticket não encontrado');

    // Sort messages by creation date
    ticket.messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return ticket;
  }

  async addMessage(ticketId: number, sender: any, message: string, isAdmin: boolean = false) {
    const ticket = await this.ticketsRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');

    const newMessage = this.messagesRepository.create({
      message,
      ticket,
      sender: { id: sender.userId } as User,
      isAdmin,
    });

    await this.messagesRepository.save(newMessage);

    // Update ticket status if admin replied
    if (isAdmin) {
      ticket.status = TicketStatus.RESPONDED;
    } else {
      ticket.status = TicketStatus.PENDING;
    }
    ticket.updatedAt = new Date();
    await this.ticketsRepository.save(ticket);

    return newMessage;
  }

  async finishTicket(ticketId: number) {
    const ticket = await this.ticketsRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');

    ticket.status = TicketStatus.FINISHED;
    ticket.updatedAt = new Date();
    return this.ticketsRepository.save(ticket);
  }

  async getAllTicketsForAdmin() {
    return this.ticketsRepository.find({
      relations: ['user'],
      order: { updatedAt: 'DESC' },
    });
  }
}
