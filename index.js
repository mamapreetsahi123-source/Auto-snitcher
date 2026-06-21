
require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder, 
    Routes, REST, EmbedBuilder, ModalBuilder, TextInputBuilder, 
    TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');
const { Client: SelfbotClient } = require('discord.js-selfbot-v14');

// Load environment variables set in the Railway configuration tab
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const activeMonitors = new Map();

// Initialize the primary Application Bot client
const bot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

// Setup application slash commands formatting structure
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
        console.error('Error deploying commands:', error);
    }
})();

bot.once('ready', () => {
    console.log(`Bot logged in as ${bot.user.tag}`);
});

// Unified Component & Interface Interaction Listener
bot.on('interactionCreate', async interaction => {
    const userId = interaction.user.id;

    // A. Handle /panel slash commands
    if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
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
            .setDisabled(!isRunning);

        const row = new ActionRowBuilder().addComponents(btnStart, btnStop);
        return await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // B. Handle UI Component Buttons 
    if (interaction.isButton()) {
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

            return await interaction.showModal(modal);
        }

        if (interaction.customId === 'panel_stop_flow') {
            if (activeMonitors.has(userId)) {
                const selfbotToKill = activeMonitors.get(userId);
                try {
                    selfbotToKill.destroy(); 
                } catch (e) {
                    console.error('Error destroying selfbot instance session:', e);
                }
                activeMonitors.delete(userId);
                return await interaction.reply({ content: '🛑 **Alerts Stopped.** Tracking session disconnected.', ephemeral: true });
            }
            return await interaction.reply({ content: '❌ You do not have any active tracking sessions running.', ephemeral: true });
        }
    }

    // C. Handle Input Modal Submissions
    if (interaction.isModalSubmit() && interaction.customId === 'log_panel_modal') {
        const userToken = interaction.fields.getTextInputValue('user_token');
        const serverId = interaction.fields.getTextInputValue('server_id');

        await interaction.reply({ content: '🔄 Verifying token and initializing join tracker...', ephemeral: true });

        // Terminate existing processes for user to prevent overlapping hooks
        if (activeMonitors.has(userId)) {
            try { activeMonitors.get(userId).destroy(); } catch(e){}
            activeMonitors.delete(userId);
        }

        try {
            // Initialize selfbot configuration with target listener intents enabled
            const selfbot = new SelfbotClient({ 
                checkUpdate: false,
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMembers
                ]
            });
            activeMonitors.set(userId, selfbot);

            // Hook target member join event payload handler
            selfbot.on('guildMemberAdd', async (member) => {
                if (member.guild.id !== serverId) return;
                
                try {
                    const alertUser = await bot.users.fetch(userId);
                    const embed = new EmbedBuilder()
                        .setTitle('🚨 New Member Alert!')
                        .setDescription(`User **${member.user.tag}** joined the target server.`)
                        .addFields(
                            { name: 'User ID', value: member.user.id, inline: true },
                            { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
                        )
                        .setColor(0x00FF00)
                        .setTimestamp();

                    await alertUser.send({ embeds: [embed] });
                } catch (err) {
                    console.error('Failed to dispatch alert DM notice:', err);
                }
            });

            selfbot.once('ready', () => {
                console.log(`Selfbot ready: ${selfbot.user.tag} active monitoring on server: ${serverId}`);
                interaction.followUp({ content: `✅ **Setup Complete!** Automated tracking is live. DM notifications activated for server ID: \`${serverId}\`.`, ephemeral: true });
            });

            await selfbot.login(userToken);

        } catch (error) {
            console.error('Selfbot Initialization error:', error);
            if (activeMonitors.has(userId)) activeMonitors.delete(userId);
            return interaction.followUp({ content: '❌ **Configuration Failed.** Double check if your token is valid or locked behind captcha verification rules.', ephemeral: true });
        }
    }
});

bot.login(BOT_TOKEN);
