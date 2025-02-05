import { Context, Schema } from 'koishi'
import { Rcon } from "rcon-client"

export const name = 'jbmc-bind';

export const inject = ['database'];

export interface Config {
    rconHost: string
    rconPort: number
    rconPassword: string
}

export const Config: Schema<Config> = Schema.object({
    rconHost: Schema.string().required().description('RCON 服务器地址'),
    rconPort: Schema.number().required().description('RCON 服务器端口'),
    rconPassword: Schema.string().required().description('RCON 密码').role('secret')
})

declare module 'koishi' {
    interface Tables {
        lunarine: Lunarine;
    }
}

interface Lunarine {
    id: number;
    user_qid: number;
    user_mid: string;
    register_time: number;
}

async function sendRCON(config: Config, command: string) {
    const rcon = await Rcon.connect({
        host: config.rconHost,
        port: config.rconPort,
        password: config.rconPassword
    })

    try {
        const result = await rcon.send(command)
        return result
    } finally {
        rcon.end()
    }
}


export function apply(ctx: Context, config: Config) {
    ctx.model.extend('lunarine', {
        // 各字段的类型声明
        id: 'unsigned',
        user_qid: 'integer',
        user_mid: 'string',
        register_time: 'unsigned'
    }, {
        primary: "id",
        autoInc: true
    });

    // 查询绑定信息
    ctx.command('lunarine/查询 [username:string]')
        .usage('查询已绑定的 Lunarine 账号')
        .action(async ({ session }, username) => {
            if (!username) {
                const userId = Number(session.event.user.id);

                // 查询绑定记录
                const existing = await ctx.database.get('lunarine', { user_qid: userId });

                if (existing.length === 0) {
                    return "你还没有绑定 Lunarine 账号哦！";
                }

                const bindInfo = existing[0];
                return `📝 绑定信息：
QQ 号：${bindInfo.user_qid}
Lunarine 用户名：${bindInfo.user_mid}
注册时间：${new Date(bindInfo.register_time).toLocaleString()}`;
            } else {
                const existing = await ctx.database.get('lunarine', { user_mid: username });

                if (existing.length === 0) {
                    return "此 Lunarine 账号还没有绑定 QQ 号哦！";
                }

                const bindInfo = existing[0];
                return `📝 绑定信息：
QQ 号：${bindInfo.user_qid}
Lunarine 用户名：${bindInfo.user_mid}
注册时间：${new Date(bindInfo.register_time).toLocaleString()}`;
            }
        });

    ctx.command('lunarine/绑定 <username:string>')
        .usage('绑定 Lunarine 账号已加入白名单。')
        .action(async ({ session }, username) => {
            if (!username) return "请指定用户名！"

            const userId = Number(session.event.user.id)
            const existing = await ctx.database.get('lunarine', { user_qid: userId })
            if (existing.length > 0) {
                return `你已经绑定过 Lunarine 账号啦！（绑定 ID：${existing[0].user_mid}）`
            }

            const existing2 = await ctx.database.get('lunarine', { user_mid: username })
            if (existing2.length > 0) {
                return `此账号已被其他人绑定（绑定 QQ：${existing2[0].user_qid}）`
            }

            // 写入数据库
            await ctx.database.create('lunarine', {
                user_qid: userId,
                user_mid: username,
                register_time: Date.now()
            })

            // 添加白名单
            try {
                await sendRCON(config, `whitelist add ${username}`)
            } catch (error) {
                ctx.logger('jbmc-bind').error(error)
                return `绑定成功，但白名单添加失败：${error.message}`
            }

            return `绑定成功！🎉\nQQ 号：${userId}\nLunarine 用户名：${username}`
        })

    // 修改后的解绑命令
    ctx.command('lunarine/解绑')
        .usage('解除 Lunarine 账号绑定')
        .action(async ({ session }) => {
            const userId = Number(session.event.user.id)
            const existing = await ctx.database.get('lunarine', { user_qid: userId })

            if (existing.length === 0) {
                return "你还没有绑定 Lunarine 账号哦！"
            }

            const username = existing[0].user_mid

            // 删除数据库记录
            await ctx.database.remove('lunarine', { user_qid: userId })

            // 移除白名单
            try {
                await sendRCON(config, `whitelist remove ${username}`)
            } catch (error) {
                ctx.logger('jbmc-bind').error(error)
                return `解绑成功，但白名单移除失败：${error.message}`
            }

            return `✅ 解绑成功！\n已解除 QQ 号 ${userId} 与 Lunarine 账号 ${username} 的绑定`
        })
}

