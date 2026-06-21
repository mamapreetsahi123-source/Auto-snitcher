require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder, 
    Routes, REST, EmbedBuilder, ModalBuilder, TextInputBuilder, 
    TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');
const { Client: SelfbotClient } = require('discord.js-selfbot-v13');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ALLOWED_GUILD_ID = "1493598034544820284"; 
const activeMonitors = new Map();

const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

const commands = [
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Manage alerts.'),
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Purge bot DMs.')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
    try {
        await rest.put(
            Routes.applicationCommands(CLIENT_ID), 
            { body: commands }
        );
        console.log('Commands reloaded.');
    } catch (e) { console.error(e); }
})();

bot.once('ready', () => console.log('Bot ready'));

function getPanelComponents(uid, run) {
    const b1 = new ButtonBuilder()
        .setCustomId(`panel_start_${uid}`)
        .setLabel('Configure & Start')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(run);
    const b2 = new ButtonBuilder()
        .setCustomId(`panel_stop_${uid}`)
        .setLabel('Stop DM Alerts')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!run);
    return new ActionRowBuilder().addComponents(b1, b2);
}

function getPanelEmbed(uid, run) {
    return new EmbedBuilder()
        .setTitle('⚙️ Control Panel')
        .setDescription(
            `Settings below.\n\n` +
            `**Owner:** <@${uid}>\n` +
            `**Status:** ${run ? '🟢 Active' : '🔴 Stopped'}`
        )
        .setColor(run ? 0x00FF00 : 0xFF0000)
        .setTimestamp();
}

bot.on('interactionCreate', async interaction => {
    const userId = interaction.user.id;

    if (interaction.isChatInputCommand() && 
        interaction.commandName === 'clear') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const dm = await interaction.user.createDM();
            const msgs = await dm.messages.fetch({ limit: 100 });
            const bMsgs = msgs.filter(m => m.author.id === bot.user.id);
            if (bMsgs.size === 0) {
                return await interaction.editReply('✨ No history found.');
            }
            let count = 0;
            for (const msg of bMsgs.values()) {
                try {
                    await msg.delete();
                    count++;
                    await new Promise(r => setTimeout(r, 600)); 
                } catch (e) {}
            }
            return await interaction.editReply(`🧹 Cleared ${count} logs!`);
        } catch (e) {
            return await interaction.editReply('❌ Purge failed.');
        }
    }

    if (interaction.isChatInputCommand() && 
        interaction.commandName === 'panel') {
        if (interaction.guildId !== ALLOWED_GUILD_ID) {
            return await interaction.reply({ 
                content: '❌ Wrong server.', 
                ephemeral: true 
            });
        }
        const run = activeMonitors.has(userId);
        return await interaction.reply({ 
            embeds: [getPanelEmbed(userId, run)], 
            components: [getPanelComponents(userId, run)] 
        });
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;
        if (customId.startsWith('panel_start_') || 
            customId.startsWith('panel_stop_')) {
            const parts = customId.split('_');
            const panelOwnerId = parts[2]; 

            if (userId !== panelOwnerId) {
                return await interaction.reply({ 
                    content: '❌ Access Denied.', 
                    ephemeral: true 
                });
            }

            if (customId.startsWith('panel_start_')) {
                if (activeMonitors.has(userId)) {
                    return await interaction.reply({ 
                        content: '❌ Running.', 
                        ephemeral: true 
                    });
                }
                const modal = new ModalBuilder()
                    .setCustomId(`modal_${interaction.message.id}`) 
                    .setTitle('Configuration');
                const tIn = new TextInputBuilder()
                    .setCustomId('user_token')
                    .setLabel('User Token')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                const sIn = new TextInputBuilder()
                    .setCustomId('server_id')
                    .setLabel('Target Server ID')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                const wIn = new TextInputBuilder()
                    .setCustomId('welcome_message')
                    .setLabel('Optional Welcome DM ({user} = Name)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(tIn),
                    new ActionRowBuilder().addComponents(sIn),
                    new ActionRowBuilder().addComponents(wIn)
                );
                return await interaction.showModal(modal);
            }

            if (customId.startsWith('panel_stop_')) {
                if (activeMonitors.has(userId)) {
                    const session = activeMonitors.get(userId);
                    try { session.client.destroy(); } catch (e) {}
                    activeMonitors.delete(userId);
                    return await interaction.update({ 
                        embeds: [getPanelEmbed(userId, false)], 
                        components: [getPanelComponents(userId, false)] 
                    });
                }
            }
        }
    }

    if (interaction.isModalSubmit() && 
        interaction.customId.startsWith('modal_')) {
        const parts = interaction.customId.split('_');
        const targetMessageId = parts[1]; 
        const userToken = interaction.fields.getTextInputValue('user_token');
        const serverId = interaction.fields.getTextInputValue('server_id');
        const welcomeMessage = interaction.fields.getTextInputValue('welcome_message');

        await interaction.deferUpdate();
        if (activeMonitors.has(userId)) {
            try { activeMonitors.get(userId).client.destroy(); } catch(e){}
            activeMonitors.delete(userId);
        }

        try {
            const selfbot = new SelfbotClient({ checkUpdate: false });
            activeMonitors.set(userId, {
                client: selfbot,
                welcomeMessage: welcomeMessage && 
                welcomeMessage.trim().length > 0 ? welcomeMessage : null
            });

            selfbot.on('guildMemberAdd', async (member) => {
                if (member.guild.id !== serverId) return;
                try {
                    const alertUser = await bot.users.fetch(userId);
                    const emb = new EmbedBuilder()
                        .setTitle('🚨 New Join!')
                        .setDescription(
                            `**Username:**\n\`${member.user.username}\`\n\n` +
                            `**User ID:**\n\`${member.user.id}\``
                        )
                        .setColor(0x00FF00)
                        .setTimestamp();
                    await alertUser.send({ embeds: [emb] });
                } catch (err) {}

                const session = activeMonitors.get(userId);
                if (session && session.welcomeMessage) {
                    // Safety timeout delay to bypass quick automation security blocks
                    await new Promise(resolve => setTimeout(resolve, 2500));
                    
                    try { 
                        // Automatically replaces any instance of {user} with their actual name string
                        let customizedText = session.welcomeMessage.replace(
                            /{user}/g, 
                            member.user.username
                        );
                        
                        await member.user.send({ content: customizedText }); 
                    } catch (e) {
                        console.log(`Failed to message joining member (DMs Closed or Blocked).`);
                    }
                }
            });

            selfbot.once('ready', async () => {
                try {
                    const chan = await bot.channels.fetch(interaction.channelId);
                    const msg = await chan.messages.fetch(targetMessageId);
                    await msg.edit({ 
                        embeds: [getPanelEmbed(userId, true)], 
                        components: [getPanelComponents(userId, true)] 
                    });
                } catch (e) {}
            });

            await selfbot.login(userToken);
        } catch (error) {
            if (activeMonitors.has(userId)) activeMonitors.delete(userId);
        }
    }
});

bot.login(BOT_TOKEN);
