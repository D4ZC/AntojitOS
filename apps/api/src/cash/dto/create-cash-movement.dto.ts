import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateCashMovementDto {
  @ApiProperty({ enum: ["in", "out"] })
  @IsIn(["in", "out"])
  direction!: "in" | "out";

  @ApiProperty({ minimum: 1, maximum: 100_000_000 })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountInCents!: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
