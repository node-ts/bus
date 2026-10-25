import { InvalidProjectName } from './error'
import { toProjectName } from './project-name'

describe('toProjectName', () => {
  describe('when the directory name is already a project name', () => {
    it('should keep it', () => {
      expect(toProjectName('library-service_2')).toEqual('library-service_2')
    })
  })

  describe('when the directory name has capitals, spaces and symbols', () => {
    it('should make it lowercase, with dashes for the rest', () => {
      expect(toProjectName('  My Library.Service! ')).toEqual(
        'my-library-service'
      )
    })
  })

  describe('when the directory name has no letters or digits', () => {
    it('should throw InvalidProjectName', () => {
      expect(() => toProjectName('@@@')).toThrow(InvalidProjectName)
    })
  })

  describe('when the directory name is longer than 50 characters', () => {
    it('should throw InvalidProjectName', () => {
      expect(() => toProjectName('a'.repeat(51))).toThrow(InvalidProjectName)
    })
  })
})
