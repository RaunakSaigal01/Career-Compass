import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async register(registerDto: RegisterDto) {
    const email = registerDto.email.toLowerCase();
    const existingUser = await this.usersService.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 12);

    const user = await this.usersService.create(
      email,
      passwordHash,
      registerDto.consentGiven,
    );

    return {
      message: 'Registration successful.',
      user: {
        id: user._id,
        email: user.email,
      },
    };
  }
}