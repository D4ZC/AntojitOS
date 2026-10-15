import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";

export class ApplyAccountAdjustmentDto {
  @ApiProperty({ enum: ["discount", "courtesy"] })
  @IsIn(["discount", "courtesy"])
  kind!: "discount" | "courtesy";

  @ApiProperty({ enum: ["percentage", "fixed"] })
  @IsIn(["percentage", "fixed"])
  calculation!: "percentage" | "fixed";

  @ApiProperty({ description: "Puntos base para porcentaje o centavos para monto fijo" })
  @IsInt()
  @Min(1)
  value!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
