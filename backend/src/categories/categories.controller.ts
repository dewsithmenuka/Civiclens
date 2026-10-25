import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { Database } from '../database/database.service';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private db: Database) {}
  @Public() @Get()
  async list() {
    return (await this.db.query('SELECT code, label, description FROM issue_categories ORDER BY code')).rows;
  }
}
