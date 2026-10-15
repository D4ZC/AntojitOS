import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

export class OpenCashShiftDto {
  @ApiProperty({ minimum: 0, maximum: 100_000_000 })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  openingFloatInCents!: number;
}
