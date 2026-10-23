import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class CreateDeliveryDriverDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

export class CreateDeliveryAssignmentDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  accountId!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  driverId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedAccountVersion!: number;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  customerName?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  address!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class DeliveryVersionDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class UpdateDeliveryStatusDto extends DeliveryVersionDto {
  @ApiProperty({ enum: ["assigned", "out_for_delivery", "delivered", "cancelled"] })
  @IsIn(["assigned", "out_for_delivery", "delivered", "cancelled"])
  status!: "assigned" | "out_for_delivery" | "delivered" | "cancelled";
}

export class RefreshDeliveryAssignmentDto extends DeliveryVersionDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedAccountVersion!: number;
}
