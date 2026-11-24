package com.vowkey.app.data.vault.datasource.disk

import android.content.Context
import android.database.Cursor
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import com.vowkey.app.data.vault.repository.util.toEncryptedNetworkCipherResponse
import com.vowkey.app.data.vault.repository.util.toEncryptedSdkCipher
import com.vowkey.core.data.manager.encryption.KeystoreManager
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.sdk.Client
import com.vowkey.vault.Cipher
import com.vowkey.vault.CipherView
import java.io.File
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher as AesCipher
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.Json

class LocalVaultStore(
    context: Context,
    private val keystoreManager: KeystoreManager,
    private val client: Client,
    private val json: Json,
) {
    private val files = context.filesDir
    private var userKey: ByteArray? = null
    private val helper = FrameworkSQLiteOpenHelperFactory().create(
        SupportSQLiteOpenHelper.Configuration.builder(context)
            .name("local-vault-v1.sqlite")
            .callback(object : SupportSQLiteOpenHelper.Callback(1) {
                override fun onCreate(db: SupportSQLiteDatabase) {
                    db.execSQL(
                        "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL," +
                            "payload BLOB NOT NULL,PRIMARY KEY(kind,id))",
                    )
                }

                override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
            })
            .build(),
    )

    @get:Synchronized
    val isUnlocked: Boolean get() = userKey != null

    @Synchronized
    fun key(): ByteArray? = userKey?.copyOf()

    val installationId: String
        get() {
            val file = File(files, "local-installation-id")
            if (!file.exists()) unlock()
            return file.readText()
        }

    @Synchronized
    fun unlock() {
        if (userKey == null) userKey = readOrCreateKey()
        val installation = File(files, "local-installation-id")
        if (!installation.exists()) installation.writeText(UUID.randomUUID().toString())
    }

    @Synchronized
    fun lock() {
        userKey?.fill(0)
        userKey = null
    }

    @Synchronized
    fun items(): List<CipherView> = encrypted().map { decrypt(it) }

    fun item(id: String): CipherView? = items().firstOrNull { it.id == id }

    // Payloads are persisted as UTF-8 BLOBs.
    private fun Cursor.payloadText(column: Int): String = String(getBlob(column), Charsets.UTF_8)

    @Synchronized
    fun encrypted(): List<Cipher> {
        if (userKey == null) return emptyList()
        val cursor = helper.readableDatabase.query("SELECT payload FROM records WHERE kind = 'cipher'")
        return buildList {
            while (cursor.moveToNext()) {
                add(json.decodeFromString<SyncResponseJson.Cipher>(cursor.payloadText(0)).toEncryptedSdkCipher())
            }
        }.also { cursor.close() }
    }
    @Synchronized
    fun save(view: CipherView): String {
        unlock()
        val key = checkNotNull(userKey)
        val id = view.id ?: UUID.randomUUID().toString()
        val sanitized = view.copy(
            attachments = view.attachments?.filter { it.key != null }?.ifEmpty { null },
        )
        val encrypted = client.vault().ciphers().encryptLegacyCipher(sanitized.withPhysicalProfileId(id), key)
        write(encrypted)
        return id
    }

    fun write(cipher: Cipher) {
        val id = checkNotNull(cipher.id)
        helper.writableDatabase.execSQL(
            "INSERT OR REPLACE INTO records(kind,id,payload) VALUES(?,?,?)",
            arrayOf("cipher", id, json.encodeToString(cipher.toStored()).toByteArray()),
        )
    }

    fun delete(id: String) {
        helper.writableDatabase.execSQL("DELETE FROM records WHERE kind = 'cipher' AND id = ?", arrayOf(id))
    }

    fun side(kind: String, id: String): String? {
        val cursor = helper.readableDatabase.query(
            "SELECT payload FROM records WHERE kind = ? AND id = ?",
            arrayOf(kind, id),
        )
        return (if (cursor.moveToFirst()) cursor.payloadText(0) else null).also { cursor.close() }
    }

    fun writeSide(kind: String, id: String, payload: String) {
        helper.writableDatabase.execSQL(
            "INSERT OR REPLACE INTO records(kind,id,payload) VALUES(?,?,?)",
            arrayOf(kind, id, payload.toByteArray()),
        )
    }

    fun deleteSide(kind: String, id: String) {
        helper.writableDatabase.execSQL("DELETE FROM records WHERE kind = ? AND id = ?", arrayOf(kind, id))
    }

    fun sides(kind: String): List<Pair<String, String>> {
        val cursor = helper.readableDatabase.query("SELECT id,payload FROM records WHERE kind = ?", arrayOf(kind))
        return buildList {
            while (cursor.moveToNext()) add(cursor.getString(0) to cursor.payloadText(1))
        }.also { cursor.close() }
    }

    fun hasGuestRecords(): Boolean = helper.readableDatabase.query(
        "SELECT 1 FROM records WHERE kind = 'cipher' LIMIT 1",
    ).use { it.moveToFirst() }

    fun attachmentFile(id: String): File {
        require(id.matches(Regex("[A-Za-z0-9_-]+")))
        return File(File(files, "local-attachments"), id)
    }

    fun deleteAttachment(id: String) { attachmentFile(id).delete() }

    fun encryptedOriginal(userId: String, cipherId: String, attachmentId: String): File =
        accountOriginalFile(files, userId, cipherId, attachmentId)

    fun retainEncryptedOriginal(userId: String, cipherId: String, attachmentId: String, bytes: ByteArray) {
        val target = encryptedOriginal(userId, cipherId, attachmentId)
        target.parentFile?.mkdirs()
        val staging = File(target.parentFile, "$attachmentId.part")
        staging.writeBytes(bytes)
        if (!staging.renameTo(target)) {
            target.writeBytes(staging.readBytes())
            staging.delete()
        }
    }

    fun readEncryptedOriginal(userId: String, cipherId: String, attachmentId: String): ByteArray? {
        val file = runCatching { encryptedOriginal(userId, cipherId, attachmentId) }.getOrNull() ?: return null
        return if (file.isFile && file.length() > 0) file.readBytes() else null
    }

    fun deleteAccountOriginals(userId: String, cipherId: String) {
        if (!userId.matches(Regex("[A-Za-z0-9_-]+")) || !cipherId.matches(Regex("[A-Za-z0-9_-]+"))) return
        File(File(files, "account-originals/$userId"), cipherId).deleteRecursively()
    }

    fun accountOriginals(userId: String, cipherId: String): Set<String> {
        if (!userId.matches(Regex("[A-Za-z0-9_-]+")) || !cipherId.matches(Regex("[A-Za-z0-9_-]+"))) return emptySet()
        return File(File(files, "account-originals/$userId"), cipherId).list()?.toSet().orEmpty()
    }

    fun writeAccountPending(userId: String, cipher: Cipher) {
        writeSide("pending:$userId", checkNotNull(cipher.id), json.encodeToString(cipher.toStored()))
    }

    fun accountPending(userId: String, key: ByteArray): List<CipherView> = sides("pending:$userId").map { (_, payload) ->
        client.vault().ciphers().decryptLegacyCipher(json.decodeFromString<SyncResponseJson.Cipher>(payload).toEncryptedSdkCipher(), key)
    }

    fun saveAccountPending(userId: String, view: CipherView, key: ByteArray) {
        writeAccountPending(userId, client.vault().ciphers().encryptLegacyCipher(view, key))
    }

    fun hasAccountPending(userId: String, id: String): Boolean = side("pending:$userId", id) != null

    private fun decrypt(cipher: Cipher): CipherView {
        val key = checkNotNull(userKey)
        val view = client.vault().ciphers().decryptLegacyCipher(cipher, key)
        return runCatching { view.withPhysicalProfileId(checkNotNull(view.id)) }.getOrDefault(view)
    }

    private fun readOrCreateKey(): ByteArray {
        val wrapped = File(files, "local-user-key")
        val keystoreKey = keystoreManager.getOrCreateKey("localUserKey").getOrThrow()
        if (wrapped.exists()) {
            val bytes = wrapped.readBytes()
            val cipher = AesCipher.getInstance("AES/GCM/NoPadding")
            cipher.init(AesCipher.DECRYPT_MODE, keystoreKey, GCMParameterSpec(128, bytes.copyOf(12)))
            return cipher.doFinal(bytes.copyOfRange(12, bytes.size))
        }
        val key = ByteArray(64).also(SecureRandom()::nextBytes)
        val cipher = AesCipher.getInstance("AES/GCM/NoPadding")
        cipher.init(AesCipher.ENCRYPT_MODE, keystoreKey)
        wrapped.writeBytes(cipher.iv + cipher.doFinal(key))
        File(files, "local-installation-id").writeText(UUID.randomUUID().toString())
        return key
    }
}

internal fun Cipher.toStored(): SyncResponseJson.Cipher =
    toEncryptedNetworkCipherResponse(encryptedFor = "").copy(encryptedFor = null)

internal fun accountOriginalFile(root: File, userId: String, cipherId: String, attachmentId: String): File {
    require(listOf(userId, cipherId, attachmentId).all { it.matches(Regex("[A-Za-z0-9_-]+")) })
    return File(File(root, "account-originals/$userId/$cipherId"), attachmentId)
}
