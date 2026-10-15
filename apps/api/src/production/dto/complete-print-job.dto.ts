import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class CompletePrintJobDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  claimToken!: string;
}
