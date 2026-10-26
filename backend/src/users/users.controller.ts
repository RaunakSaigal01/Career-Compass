import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    const profile = await this.usersService.getProfile(req.user.id);
    return {
      email: req.user.email,
      ...profile.toObject(),
    };
  }

  @Patch('profile')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateUserProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(req.user.id, dto);
    return {
      email: req.user.email,
      ...updated.toObject(),
    };
  }
}