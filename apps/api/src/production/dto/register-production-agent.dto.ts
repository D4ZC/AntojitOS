import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class RegisterProductionAgentDto {
  @ApiProperty({ example: "PILOT" })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,24}$/)
  siteCode!: string;

  @ApiProperty({ example: "PRINT-01" })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,24}$/)
  code!: string;

  @ApiProperty({ example: "Agente PC principal" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ type: [String], example: ["KITCHEN", "BAR"] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[A-Z0-9_-]{2,24}$/, { each: true })
  centerCodes!: string[];
}
