import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

export class UpdateModifierPriceDto {
  @ApiProperty()
  @IsInt()
  expectedPriceDeltaInCents!: number;

  @ApiProperty({ minimum: 0, maximum: 1_000_000 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priceDeltaInCents!: number;
}
