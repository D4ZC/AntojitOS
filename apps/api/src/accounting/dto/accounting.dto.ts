import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export class CreateSupplierDto {
  @ApiProperty({ maxLength: 160 })
  @IsString() @IsNotEmpty() @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional() @IsString() @MaxLength(160)
  contactName?: string | null;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional() @IsString() @MaxLength(40)
  taxId?: string | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class UpdateSupplierDto {
  @ApiProperty({ minimum: 0 })
  @IsInt() @Min(0)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional() @IsString() @MaxLength(160)
  contactName?: string | null;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional() @IsString() @MaxLength(60)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional() @IsString() @MaxLength(40)
  taxId?: string | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  active?: boolean;
}

export class CreateBillDto {
  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional() @IsUUID("4")
  supplierId?: string | null;

  @ApiProperty({ maxLength: 240 })
  @IsString() @IsNotEmpty() @MaxLength(240)
  description!: string;

  @ApiProperty({ minimum: 1, maximum: 100_000_000 })
  @IsInt() @Min(1) @Max(100_000_000)
  amountInCents!: number;

  @ApiProperty({ example: "2026-10-23" })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issuedOn!: string;

  @ApiPropertyOptional({ example: "2026-11-01" })
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueOn?: string | null;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional() @IsString() @MaxLength(160)
  reference?: string | null;
}

export class CreateSupplierPaymentDto {
  @ApiProperty({ minimum: 0 })
  @IsInt() @Min(0)
  expectedVersion!: number;

  @ApiProperty({ minimum: 1, maximum: 100_000_000 })
  @IsInt() @Min(1) @Max(100_000_000)
  amountInCents!: number;

  @ApiProperty({ enum: ["CASH", "CARD", "TRANSFER"] })
  @IsIn(["CASH", "CARD", "TRANSFER"])
  methodCode!: "CASH" | "CARD" | "TRANSFER";

  @ApiProperty({ enum: ["business_cash", "external"] })
  @IsIn(["business_cash", "external"])
  source!: "business_cash" | "external";

  @ApiProperty({ example: "2026-10-23" })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paidOn!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional() @IsString() @MaxLength(160)
  reference?: string | null;
}

export class VoidSupplierPaymentDto {
  @ApiProperty({ minimum: 0 })
  @IsInt() @Min(0)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 240 })
  @IsString() @IsNotEmpty() @MaxLength(240)
  reason!: string;
}

export class VoidBillDto extends VoidSupplierPaymentDto {}

export class AccountingSummaryQueryDto {
  @ApiPropertyOptional({ example: "2026-10-01" })
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: "2026-10-31" })
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
