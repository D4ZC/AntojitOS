import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";

export class UpdateTerminalDto {
  @ApiProperty({ example: "Tablet caja principal" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ example: 0, description: "Versión observada por el cliente" })
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

