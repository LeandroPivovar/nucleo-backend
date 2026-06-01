import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BOT_FLOW_CHANNELS } from '../bot-flow-channel';

export class CreateBotFlowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsIn([...BOT_FLOW_CHANNELS], {
    message: 'Canal inválido',
  })
  channel: string;
}
