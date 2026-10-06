import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";

export class RegisterTerminalDto {
  @ApiProperty({ example: "PILOT" })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,24}$/)
  siteCode!: string;

  @ApiProperty({ example: "POS-01" })
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,24}$/)
  terminalCode!: string;

  @ApiProperty({ example: "Tablet mostrador" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ enum: ["pos", "admin", "kds", "production"], default: "pos" })
  @IsIn(["pos", "admin", "kds", "production"])
  profile!: "pos" | "admin" | "kds" | "production";
}

