import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

export class UpdateProductPriceDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ minimum: 0, maximum: 1_000_000 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priceInCents!: number;
}
