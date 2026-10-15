import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  Min,
  ValidateNested,
} from "class-validator";

export class CashDeclarationDto {
  @ApiProperty({ enum: ["CASH", "CARD", "TRANSFER"] })
  @IsIn(["CASH", "CARD", "TRANSFER"])
  methodCode!: "CASH" | "CARD" | "TRANSFER";

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  declaredInCents!: number;
}

export class CloseCashShiftDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ type: [CashDeclarationDto], minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CashDeclarationDto)
  declarations!: CashDeclarationDto[];
}
