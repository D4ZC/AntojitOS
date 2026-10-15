import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class CheckoutTenderDto {
  @ApiProperty({ enum: ["CASH", "CARD", "TRANSFER"] })
  @IsIn(["CASH", "CARD", "TRANSFER"])
  methodCode!: "CASH" | "CARD" | "TRANSFER";

  @ApiProperty({ minimum: 1, description: "Importe aplicado a la venta" })
  @IsInt()
  @Min(1)
  amountInCents!: number;

  @ApiProperty({ minimum: 0, description: "Propina separada de la venta" })
  @IsInt()
  @Min(0)
  tipInCents!: number;

  @ApiPropertyOptional({ minimum: 1, description: "Efectivo recibido" })
  @IsOptional()
  @IsInt()
  @Min(1)
  tenderedInCents?: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  reference?: string;
}

export class CheckoutAccountDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ type: [CheckoutTenderDto], minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CheckoutTenderDto)
  payments!: CheckoutTenderDto[];
}
