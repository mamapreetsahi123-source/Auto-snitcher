require('dotenv').config();

// --- CRITICAL ERROR HANDLERS ---
// Prevents the process from crashing on unhandled errors
process.on('uncaughtException', (err) => {
    console.error('CRITICAL Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- COMPATIBILITY PATCH ---
if (typeof File === 'undefined') {
    global.File = class File extends Blob {
        constructor(parts, name, options) {
            super(parts, options);
            this.name = name;
        }
    };
}

const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder, 
    Routes, REST, EmbedBuilder, ModalBuilder, TextInputBuilder, 
    TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');
const { Client: SelfbotClient } = require('discord.js-selfbot-v13');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ALLOWED_CHANNEL_ID = "1518442820875194398"; 
const ADMIN_USER_ID = "1277163202614001706";

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
    new SlashCommandBuilder().setName('panel').setDescription('Manage alerts.'),
    new SlashCommandBuilder().setName('clear').setDescription('Purge bot DMs.'),
    new SlashCommandBuilder().setName('setup').setDescription('Admin server-channel logging setup.')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Commands reloaded.');
    } catch (e) { console.error(e); }
})();

bot.once('ready', () => console.log('Bot ready'));

function getPanelComponents(uid, run, isSetup = false) {
    const type = isSetup ? 'setup' : 'panel';
    const b1 = new ButtonBuilder()
        .setCustomId(`${type}_start_${uid}`)
        .setLabel('Configure & Start')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(run);
    const b2 = new ButtonBuilder()
        .setCustomId(`${type}_stop_${uid}`)
        .setLabel('Stop Alerts')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!run);
    return new ActionRowBuilder().addComponents(b1, b2);
}

function getPanelEmbed(uid, run, title = '⚙️ Control Panel') {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(`Settings below.\n\n**Owner:** <@${uid}>\n**Status:** ${run ? '🟢 Active & Monitoring' : '🔴 Stopped'}`)
        .setColor(run ? 0x00FF00 : 0xFF0000)
        .setTimestamp();
}

bot.on('interactionCreate', async interaction => {
    const userId = interaction.user.id;

    if (interaction.isChatInputCommand() && interaction.commandName === 'clear') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const dm = await interaction.user.createDM();
            const msgs = await dm.messages.fetch({ limit: 100 });
            const bMsgs = msgs.filter(m => m.author.id === bot.user.id);
            if (bMsgs.size === 0) return await interaction.editReply('✨ No history found.');
            let count = 0;
            for (const msg of bMsgs.values()) {
                try {
                    await msg.delete();
                    count++;
                    await new Promise(r => setTimeout(r, 600)); 
                } catch (e) {}
            }
            return await interaction.editReply(`🧹 Cleared ${count} logs!`);
        } catch (e) { return await interaction.editReply('❌ Purge failed.'); }
    }

    if (interaction.isChatInputCommand() && (interaction.commandName === 'panel' || interaction.commandName === 'setup')) {
        if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
            return await interaction.reply({ 
                content: `❌ This command can only be used in <#${ALLOWED_CHANNEL_ID}>.`, 
                ephemeral: true 
            });
        }
        if (interaction.commandName === 'setup' && userId !== ADMIN_USER_ID) {
            return await interaction.reply({
                content: '❌ You do not have permission to use the setup command.',
                ephemeral: true
            });
        }
        const run = activeMonitors.has(userId);
        const title = interaction.commandName === 'setup' ? '⚙️ Admin Setup Panel' : '⚙️ Control Panel';
        return await interaction.reply({ 
            embeds: [getPanelEmbed(userId, run, title)], 
            components: [getPanelComponents(userId, run, interaction.commandName === 'setup')] 
        });
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;
        const isSetupFlow = customId.startsWith('setup_');
        
        if (customId.startsWith('panel_start_') || customId.startsWith('panel_stop_') ||
            customId.startsWith('setup_start_') || customId.startsWith('setup_stop_')) {
            
            const parts = customId.split('_');
            const panelOwnerId = parts[2]; 

            if (userId !== panelOwnerId) {
                return await interaction.reply({ content: '❌ Access Denied.', ephemeral: true });
            }

            if (customId.includes('_start_')) {
                if (activeMonitors.has(userId)) {
                    return await interaction.reply({ content: '❌ Running.', ephemeral: true });
                }
                
                const prefix = isSetupFlow ? 'msetup' : 'mmodal';
                const modal = new ModalBuilder()
                    .setCustomId(`${prefix}_${interaction.message.id}`) 
                    .setTitle(isSetupFlow ? 'Admin Configuration' : 'Configuration');
                
                const tIn = new TextInputBuilder().setCustomId('user_token').setLabel('User Token').setStyle(TextInputStyle.Short).setRequired(true);
                const sIn = new TextInputBuilder().setCustomId('server_id').setLabel('Target Server ID').setStyle(TextInputStyle.Short).setRequired(true);
                
                const rows = [
                    new ActionRowBuilder().addComponents(tIn),
                    new ActionRowBuilder().addComponents(sIn)
                ];

                if (isSetupFlow) {
                    const cIn = new TextInputBuilder().setCustomId('channel_id').setLabel('Log Channel ID').setStyle(TextInputStyle.Short).setRequired(true);
                    rows.push(new ActionRowBuilder().addComponents(cIn));
                }

                modal.addComponents(rows);
                return await interaction.showModal(modal);
            }

            if (customId.includes('_stop_')) {
                if (activeMonitors.has(userId)) {
                    const session = activeMonitors.get(userId);
                    try { session.destroy(); } catch (e) {}
                    activeMonitors.delete(userId);
                    
                    const title = isSetupFlow ? '⚙️ Admin Setup Panel' : '⚙️ Control Panel';
                    return await interaction.update({ 
                        embeds: [getPanelEmbed(userId, false, title)], 
                        components: [getPanelComponents(userId, false, isSetupFlow)] 
                    });
                }
            }
        }
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith('mmodal_') || interaction.customId.startsWith('msetup_'))) {
        const isSetupModal = interaction.customId.startsWith('msetup_');
        const parts = interaction.customId.split('_');
        const targetMessageId = parts[1]; 
        const userToken = interaction.fields.getTextInputValue('user_token');
        const serverId = interaction.fields.getTextInputValue('server_id');
        let destChannelId = null;

        if (isSetupModal) {
            destChannelId = interaction.fields.getTextInputValue('channel_id');
        }

        await interaction.deferUpdate();
        
        const title = isSetupModal ? '⚙️ Admin Setup Panel' : '⚙️ Control Panel';
        try {
            const chan = await bot.channels.fetch(interaction.channelId);
            const msg = await chan.messages.fetch(targetMessageId);
            await msg.edit({ 
                embeds: [getPanelEmbed(userId, true, title)], 
                components: [getPanelComponents(userId, true, isSetupModal)] 
            });
        } catch (editError) { console.error(editError); }

        if (activeMonitors.has(userId)) {
            try { activeMonitors.get(userId).destroy(); } catch(e){}
            activeMonitors.delete(userId);
        }

        try {
            const selfbot = new SelfbotClient({ checkUpdate: false });
            
            selfbot.on('guildMemberAdd', async (member) => {
                if (member.guild.id !== serverId) return;
                try {
                    const guild = await selfbot.guilds.fetch(serverId);
                    const emb = new EmbedBuilder()
                        .setTitle('🚨 New Join!')
                        .setThumbnail(guild.iconURL())
                        .setDescription(
                            `**Server:** ${guild.name}\n` +
                            `**Total Members:** ${guild.memberCount}\n\n` +
                            `**User:** <@${member.user.id}>\n` +
                            `**Username:** \`${member.user.username}\`\n` +
                            `**User ID:** \`${member.user.id}\``
                        )
                        .setColor(0x00FF00)
                        .setTimestamp();

                    if (isSetupModal && destChannelId) {
                        const targetChan = await bot.channels.fetch(destChannelId);
                        if (targetChan) await targetChan.send({ embeds: [emb] });
                    } else {
                        const alertUser = await bot.users.fetch(userId);
                        await alertUser.send({ embeds: [emb] });
                    }
                } catch (err) { console.error('Logging action failed:', err); }
            });

            selfbot.once('ready', async () => {
                try {
                    const targetGuild = await selfbot.guilds.fetch(serverId);
                    if (!targetGuild) throw new Error('Guild not found');
                    console.log(`Monitoring: ${serverId}`);
                } catch (guildError) {
                    selfbot.destroy();
                    activeMonitors.delete(userId);
                    try {
                        const chan = await bot.channels.fetch(interaction.channelId);
                        const msg = await chan.messages.fetch(targetMessageId);
                        await msg.edit({ 
                            embeds: [getPanelEmbed(userId, false, title)], 
                            components: [getPanelComponents(userId, false, isSetupModal)] 
                        });
                        await interaction.followUp({
                            content: '❌ **you have filled wrong server id or token**',
                            ephemeral: true
                        });
                    } catch (e) { console.error(e); }
                }
            });

            activeMonitors.set(userId, selfbot);
            await selfbot.login(userToken);

        } catch (error) {
            if (activeMonitors.has(userId)) activeMonitors.delete(userId);
            try {
                const chan = await bot.channels.fetch(interaction.channelId);
                const msg = await chan.messages.fetch(targetMessageId);
                await msg.edit({
                    embeds: [getPanelEmbed(userId, false, title)],
                    components: [getPanelComponents(userId, false, isSetupModal)]
                });
                await interaction.followUp({
                    content: '❌ **you have filled wrong server id or token**',
                    ephemeral: true
                });
            } catch (e) { console.error(e); }
        }
    }
});

bot.login(BOT_TOKEN);
