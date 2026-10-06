import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

export class OpenAccountDto {
  @ApiProperty({ enum: ["table", "quick", "takeaway"] })
  @IsIn(["table", "quick", "takeaway"])
  serviceType!: "table" | "quick" | "takeaway";

  @ApiPropertyOptional()
  @ValidateIf((input: OpenAccountDto) => input.serviceType === "table")
  @IsUUID()
  tableId?: string;

  @ApiProperty({ minimum: 1, maximum: 99, default: 1 })
  @IsInt()
  @Min(1)
  @Max(99)
  guestCount!: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;
}

