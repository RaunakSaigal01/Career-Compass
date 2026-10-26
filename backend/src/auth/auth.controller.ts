import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleTokenDto } from './dto/google-token.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('google')
  googleLogin(@Body() googleTokenDto: GoogleTokenDto) {
    return this.authService.googleLogin(googleTokenDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { user: req.user };
  }
}
