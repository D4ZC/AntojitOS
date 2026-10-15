import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { CompletePrintJobDto } from "./complete-print-job.dto.js";

export class FailPrintJobDto extends CompletePrintJobDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  error!: string;
}
