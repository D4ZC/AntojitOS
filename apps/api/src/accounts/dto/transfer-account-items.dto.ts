import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { AccountItemSelectionDto } from "./account-item-selection.dto.js";

export class TransferAccountItemsDto {
  @ApiProperty()
  @IsUUID()
  destinationAccountId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  sourceExpectedVersion!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  destinationExpectedVersion!: number;

  @ApiProperty({ type: [AccountItemSelectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AccountItemSelectionDto)
  items!: AccountItemSelectionDto[];

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
