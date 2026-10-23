import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import { UpdateAccountDetailsDto } from "./update-account-details.dto.js";

export class UpdateAccountContextDto extends UpdateAccountDetailsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  responsibleUserId?: string;
}
