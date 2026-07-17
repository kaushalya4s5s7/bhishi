import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class FundCreateDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(20)
  seats!: number;
}
