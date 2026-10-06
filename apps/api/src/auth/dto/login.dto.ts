import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsUUID, Length, MaxLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "00000000-0000-4000-8000-000000000101" })
  @IsUUID()
  terminalId!: string;

  @ApiProperty({ example: "ADMIN" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  employeeCode!: string;

  @ApiProperty({ example: "1234" })
  @IsString()
  @Length(4, 12)
  pin!: string;

  @ApiProperty({ description: "Secreto entregado al registrar la terminal" })
  @IsString()
  @IsNotEmpty()
  deviceToken!: string;
}

