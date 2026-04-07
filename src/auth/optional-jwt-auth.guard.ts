import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err, user, info) {
    // Retorna o usuário se encontrado, ou null caso contrário, sem lançar erro 401
    return user || null;
  }
}
