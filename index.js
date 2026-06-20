
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, Routes, REST, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Client: SelfbotClient } = require('discord-selfbot-v14');

// Your Discord Bot Token (for the slash command)
const BOT_TOKEN = 'YOUR_DISCORD_BOT_TOKEN_HERE';
const CLIENT_ID = 'YOUR_DISCORD_BOT_CLIENT_ID_HERE';

// Store active selfbot sessions in memory (Map<userId, SelfbotClient>)
const activeMonitors = new Map();

// Initialize Main Discord Bot
const bot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

// Register /panel Slash Command
const commands = [
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Manage your target server log alerts.')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

bot.once('ready', () => {
    console.log(`Bot logged in as ${bot.user.tag}`);
});

// 1. Handle /panel command (Sends buttons)
bot.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'panel') {
        const userId = interaction.user.id;
        const isRunning = activeMonitors.has(userId);

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Join Logger Control Panel')
            .setDescription(`Manage your automated tracking settings below.\n\n**Current Status:** ${isRunning ? '🟢 Active & Monitoring' : '🔴 Stopped'}`)
            .setColor(isRunning ? 0x00FF00 : 0xFF0000)
            .setTimestamp();

        const btnStart = new ButtonBuilder()
            .setCustomId('panel_start_flow')
            .setLabel('Configure & Start')
            .setStyle(ButtonStyle.Primary);

        const btnStop = new ButtonBuilder()
            .setCustomId('panel_stop_flow')
            .setLabel('Stop DM Alerts')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isRunning); // Gray out if no tracking is active

        const row = new ActionRowBuilder().addComponents(btnStart, btnStop);

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
});

// 2. Handle Button Clicks
bot.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;

    // A. Start flow clicked -> Show Modal
    if (interaction.customId === 'panel_start_flow') {
        const modal = new ModalBuilder()
            .setCustomId('log_panel_modal')
            .setTitle('Target Server Configuration');

        const tokenInput = new TextInputBuilder()
            .setCustomId('user_token')
            .setLabel('User Token (Account in Target Server)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Paste your Discord account token here')
            .setRequired(true);

        const serverIdInput = new TextInputBuilder()
            .setCustomId('server_id')
            .setLabel('Target Server ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the target server ID')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(tokenInput),
            new ActionRowBuilder().addComponents(serverIdInput)
        );

        await interaction.showModal(modal);
    }

    // B. Stop flow clicked -> Kill the userbot
    if (interaction.customId === 'panel_stop_flow') {
        if (activeMonitors.has(userId)) {
            const selfbotToKill = activeMonitors.get(userId);
            try {
                selfbotToKill.destroy(); // Properly logs out and terminates the socket
            } catch (e) {
                console.error('Error destroying selfbot:', e);
            }
            activeMonitors.delete(userId);

            await interaction.reply({ content: '🛑 **Alerts Stopped.** The logging bot tracking your server has been shut down and disconnected.', ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ You do not have any active tracking sessions running.', ephemeral: true });
        }
    }
});

// 3. Handle Modal Submission (Spawns userbot tracking)
bot.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'log_panel_modal') return;

    const userToken = interaction.fields.getTextInputValue('user_token');
    const serverId = interaction.fields.getTextInputValue('server_id');
    const alertUserId = interaction.user.id;

    await interaction.reply({ content: '🔄 Verifying user token and initializing join tracker...', ephemeral: true });

    try {
        // Safe check: Close old connection if user forgot to stop it
        if (activeMonitors.has(alertUserId)) {
            try { activeMonitors.get(alertUserId).destroy(); } catch(e){}
            activeMonitors.delete(alertUserId);
        }

        // Initialize User Account Client (Selfbot)
        const selfbot = new SelfbotClient({ checkUpdate: false });
        activeMonitors.set(alertUserId, selfbot);

        // Capture Member Join
        selfbot.on('guildMemberAdd', async (member) => {
            if (member.guild.id === serverId) {
                try {
                    const alertUser = await bot.users.fetch(alertUserId);
                    const dmChannel = await alertUser.createDM();

                    const embed = new EmbedBuilder()
                        .setTitle('🚨 New Member Alert!')
                        .setDescription(`User **${member.user.tag}** joined the target server.`)
                        .addFields(
                            { name: 'User ID', value: member.user.id, inline: true },
                            { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
                        )
                        .setColor(0x00FF00)
                        .setTimestamp();

                    await dmChannel.send({ embeds: [embed] });
                } catch (err) {
                    console.error('Failed to send DM alert:', err);
                }
            }
        });

        selfbot.once('ready', () => {
            console.log(`Selfbot logged in as ${selfbot.user.tag} tracking server ${serverId}`);
            interaction.followUp({ content: `✅ **Setup Complete!** Your token is active. You will receive direct messages whenever someone joins server ID: \`${serverId}\`. Use \`/panel\` again to stop it anytime.`, ephemeral: true });
        });

        // Log in to the target user account via token
        await selfbot.login(userToken);

    } catch (error) {
        console.error('Login error:', error);
        if (activeMonitors.has(alertUserId)) activeMonitors.delete(alertUserId);
        interaction.followUp({ content: '❌ **Configuration Failed.** Check if your token is valid or if your account is locked behind a captcha restriction.', ephemeral: true });
    }
});

bot.login(BOT_TOKEN);

