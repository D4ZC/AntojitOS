import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateSeasonalProductDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ minimum: 0, maximum: 10_000_00 })
  @IsInt()
  @Min(0)
  @Max(10_000_00)
  priceInCents!: number;
}
