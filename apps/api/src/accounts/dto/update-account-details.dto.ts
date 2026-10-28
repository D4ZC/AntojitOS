import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class UpdateAccountDetailsDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerName?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString({ strict: true })
  scheduledFor?: string | null;
}
