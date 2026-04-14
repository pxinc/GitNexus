// simple.ets - ArkTS/HarmonyOS test fixture

import { Router } from '@ohos.router'
import type { UserInfo } from './types'

@Entry
@Component
struct MainPage {
  @State message: string = 'Hello World'
  @State count: number = 0

  build() {
    Column() {
      Text(this.message)
        .fontSize(20)
      Button('Click me')
        .onClick(() => {
          this.count++
        })
    }
  }
}

class UserService extends BaseService implements ILogger {
  name: string = ''
  private version: number = 1

  greet(user: UserInfo): string {
    console.log(user.name)
    return user.name
  }

  log(msg: string): void {
    console.log(msg)
  }
}

interface ILogger {
  log(msg: string): void
}

function createService(name: string): UserService {
  return new UserService()
}

const handler = (event: string) => event.toUpperCase()

export { MainPage }
export { UserService } from './service'
