import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateCustomerDto {
  @ApiProperty({ maxLength: 80 })
  @IsString() @IsNotEmpty() @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional() @IsString() @MaxLength(60)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional() @IsString() @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class UpdateCustomerDto {
  @ApiProperty({ minimum: 0 })
  @IsInt() @Min(0)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional() @IsString() @MaxLength(60)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional() @IsString() @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  active?: boolean;
}
