import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { GoogleTokenDto } from './dto/google-token.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export interface AuthResult {
  message: string;
  accessToken: string;
  user: {
    id: string;
    email: string;
  };
}

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  private buildAuthResponse(
    message: string,
    user: { _id: unknown; email: string },
  ): AuthResult {
    const accessToken = this.jwtService.sign({
      sub: String(user._id),
      email: user.email,
    });

    return {
      message,
      accessToken,
      user: {
        id: String(user._id),
        email: user.email,
      },
    };
  }

  async register(registerDto: RegisterDto): Promise<AuthResult> {
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

    return this.buildAuthResponse('Registration successful.', user);
  }

  async login(loginDto: LoginDto): Promise<AuthResult> {
    const email = loginDto.email.toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.buildAuthResponse('Login successful.', user);
  }

  async googleLogin(googleTokenDto: GoogleTokenDto): Promise<AuthResult> {
    const ticket = await this.googleClient.verifyIdToken({
      idToken: googleTokenDto.credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException('Google account verification failed.');
    }

    const email = payload.email.toLowerCase();

    let user = await this.usersService.findByGoogleId(payload.sub);

    if (!user) {
      user = await this.usersService.findByEmail(email);
    }

    if (!user) {
      if (!googleTokenDto.consentGiven) {
        throw new BadRequestException(
          'Please accept the Terms of use and Privacy policy to continue.',
        );
      }

      user = await this.usersService.createGoogleUser(email, payload.sub, true);
    }

    return this.buildAuthResponse('Google sign-in successful.', user);
  }
}
